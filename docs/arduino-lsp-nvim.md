# Arduino LSP in Neovim — Investigation Notes

## Problem

Go to Definition does not work when editing the radiator firmware in Neovim.
Placing the cursor on a function call such as `sleepFor()` in `radiator.ino` and
pressing `gd` produces this error popup:

```
LSP[arduino_language_server]: Error INVALID_SERVER_MESSAGE: {
  error = {
    code = -32603,
    message = "Document is not available: file:///home/philipf/projects/gotta-go/src/radiator/sleep.cpp"
  },
  ...
}
```

The error appeared consistently for any function whose definition lives in a
`.cpp` file (`net.cpp`, `sleep.cpp`, `frame.cpp`, `problem.cpp`). After the
error, the LSP server crashed and stopped responding until Neovim was restarted.

## Background — how the Arduino Language Server works

`arduino-language-server` is a proxy process that sits between Neovim (the LSP
client) and `clangd` (the C++ analysis engine). The Arduino build system copies
sketch files into a hash-named cache directory before compiling:

```
~/.cache/arduino/sketches/<HASH>/sketch/net.cpp   ← cache copy
~/.cache/arduino/sketches/<HASH>/compile_commands.json
```

The proxy's job is to translate paths in both directions:

- Neovim → real path → cache path → clangd
- clangd → cache path → real path → Neovim

## What we tried

### Attempt 1 — missing required flags

`arduino-language-server` requires three flags to function: `-fqbn` (the board),
`-clangd` (path to clangd), and `-cli` (path to arduino-cli). Without them the
server starts but cannot build a compilation database or perform path
translation.

The default Neovim/LazyVim config runs the server with no arguments:

```lua
cmd = { "arduino-language-server" }
```

We added all required flags and read the FQBN dynamically from `sketch.yaml`
using an `on_new_config` callback:

```lua
arduino_language_server = {
  cmd = { "arduino-language-server" },
  on_new_config = function(config, root_dir)
    local f = io.open(root_dir .. "/sketch.yaml", "r")
    ...
    config.cmd = { "arduino-language-server", "-fqbn", fqbn, ... }
  end,
},
```

**Result: no change.** The callback was silently ignored. LazyVim v2 uses
`vim.lsp.config()` — Neovim 0.11's native LSP API — which does not call
`on_new_config`. That callback is only processed by the old lspconfig v1
`setup()` path, which lspconfig v2 marks as "only useful for Neovim older than
0.11."

### Attempt 2 — hardcoded cmd with all required flags

We set `cmd` directly with the FQBN from `sketch.yaml` hardcoded:

```lua
arduino_language_server = {
  cmd = {
    "arduino-language-server",
    "-clangd", "/usr/bin/clangd",
    "-cli", "arduino-cli",
    "-cli-config", vim.fn.expand("~/.arduino15/arduino-cli.yaml"),
    "-fqbn", "esp32:esp32:esp32s3:FlashSize=16M,...",
  },
},
```

**Result: still the same error.** The server now started correctly and the LSP
log confirmed the path translation was running. The server successfully mapped
the clangd cache path back to the real source path. But it then checked whether
the target file was in its internal "known documents" registry — a list that
only contains files explicitly opened in Neovim — and crashed:

```
!!! Unresolved .ino path: /home/.../src/radiator/net.cpp
!!! Known doc paths are:
!!! > /home/.../src/radiator/radiator.ino
ERROR: Document is not available: file:///home/.../net.cpp
IDE     LS --> Clangd NOTIF exit        ← server crashes here
```

Only `radiator.ino` was in the registry because `arduino-language-server` only
attaches to the `arduino` filetype (`.ino` files). Opening `net.cpp` in Neovim
does not send `textDocument/didOpen` to `arduino-language-server`, so `.cpp`
files are never registered. When Go to Definition lands in a `.cpp` file the
server panics rather than returning the translated location.

This is a bug in `arduino-language-server`. The correct behaviour would be to
return the translated path unconditionally for `.cpp`/`.h` files and let Neovim
open them. It does not do this, and the bug appears unfixed in the current
version.

## Conclusion

`arduino-language-server` does not support Go to Definition when the target is a
`.cpp` file in the same sketch directory. There is no Neovim-side workaround: the
crash happens inside the server after a successful path translation.

## Viable alternative — clangd with a translated compile_commands.json

`clangd` handles multi-file C++ projects natively without a proxy, but it needs
a `compile_commands.json` with real source paths. The file that `arduino-cli
compile` generates uses the cache directory paths, not the real ones.

The script `src/radiator/gen_compile_commands.py` translates the cache
`compile_commands.json` to real paths and writes the result to the sketch
directory. It also maps the merged `radiator.ino.cpp` (which does not exist on
disk) back to `radiator.ino` (the file you actually edit), so clangd can index
the orchestrator file too.

Generate it once with `arduino-cli compile` (or `./flash.sh dev`) done first to
populate the build cache:

```bash
cd src/radiator
arduino-cli compile          # populates the build cache (skip if already built)
python3 gen_compile_commands.py
```

**You do not need to re-run this after every compile.** The compile flags clangd
needs — the ~200 `-I` include paths and `-D` defines — are stable: they only
change when you **add a library** (`arduino-cli lib install`), **change board
options in `sketch.yaml`**, or **bump the ESP32 core** (pinned to 2.0.15 by
ADR-0006). Editing or adding source files does **not** require a re-run; clangd
applies the cached flags to every file in the sketch tree. (An earlier version
of this note said "after each compile" — that was wrong, and made the setup feel
far more manual than it is.)

Then configure Neovim so that `clangd` owns a `.ino` **only when the sketch has
a `compile_commands.json`**, leaving simple `.ino`-only sketches to
`arduino-language-server` (which is fine for single-file sketches). The switch
is each server's `root_dir`:

```lua
-- in ~/.config/nvim/lua/plugins/lspconfig.lua, under opts.servers
clangd = {
  filetypes = { "c", "cpp", "objc", "objcpp", "cuda", "proto", "arduino" },
  get_language_id = function(_, ftype)
    if ftype == "arduino" then return "cpp" end  -- parse .ino with the C++ frontend
    local t = { objc = "objective-c", objcpp = "objective-cpp", cuda = "cuda-cpp" }
    return t[ftype] or ftype
  end,
  root_dir = function(bufnr, on_dir)
    local fname = vim.api.nvim_buf_get_name(bufnr)
    local dir = vim.fs.dirname(fname)
    if vim.bo[bufnr].filetype == "arduino" then
      local cc = vim.fs.find("compile_commands.json", { upward = true, path = dir })[1]
      if cc then on_dir(vim.fs.dirname(cc)) end  -- claim .ino only if a DB exists
      return
    end
    on_dir(vim.fs.root(fname, {  -- unchanged C/C++ behaviour
      ".clangd", ".clang-tidy", ".clang-format",
      "compile_commands.json", "compile_flags.txt", "configure.ac", ".git",
    }))
  end,
},
arduino_language_server = {
  root_dir = function(bufnr, on_dir)
    local fname = vim.api.nvim_buf_get_name(bufnr)
    local dir = vim.fs.dirname(fname)
    if vim.fs.find("compile_commands.json", { upward = true, path = dir })[1] then
      return  -- DB present → clangd owns it; stand down
    end
    on_dir(require("lspconfig.util").root_pattern("*.ino")(fname))
  end,
},
```

With this setup, Go to Definition, hover, completions, and cross-file
navigation all work across `radiator.ino`, `net.cpp`, `sleep.cpp`,
`frame.cpp`, and `problem.cpp` — while other simple sketches keep using
`arduino-language-server` untouched.

The generated `compile_commands.json` is gitignored (`src/radiator/.gitignore`)
because it is a derived build artifact. Re-run `gen_compile_commands.py` only
when the **build configuration** changes — a new library, a `sketch.yaml` board
option, or an ESP32 core bump.
