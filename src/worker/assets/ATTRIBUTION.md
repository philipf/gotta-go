# Bundled third-party assets

Attribution for non-code assets bundled into the Worker. See
[ADR-0009](../../../docs/adr/0009-display-typeface-dejavu-sans-bold.md) for the
typeface decision.

## yao-ming.png — idle_jokes meme

- **Subject:** the "Yao Ming Face" (a.k.a. "Bitch Please") rage-comic meme — a
  widely-circulated line-art caricature derived from a 2009 press-conference photo.
- **Use:** rendered alongside the dad joke in the `idle_jokes` layout (#17), shown
  only on the overnight idle profile of a private 5-radiator household.
- **Treatment:** traced from a freely-circulating vector, reduced to a 1-bit
  bilevel PNG (cropped, thresholded, bordered) for the e-ink panel. No commercial
  use, no redistribution beyond this private deployment.
- **Note:** rage-comic memes are community-created and circulate without a single
  authoritative rights holder; this bundles a cleaned copy rather than hot-linking
  a third-party image host (which would add an upstream failure mode and link rot).
  Replace or remove if a rights concern surfaces.

## DejaVuSans-Bold.ttf — display typeface

- **Family:** DejaVu Sans, Bold
- **Source:** [DejaVu Fonts](https://dejavu-fonts.github.io/)
- **License:** Free license, based on the Bitstream Vera Fonts Copyright
  (a permissive MIT-style grant to use, copy, modify, and redistribute). DejaVu
  changes are in the public domain; Arev-imported glyphs © Tavmjong Bah.
- **Notice:** The full license text must accompany redistributed copies. Bundled
  verbatim (no modification or subsetting), so the "renamed if modified" clause
  does not apply.

```
Fonts are (c) Bitstream (see below). DejaVu changes are in public domain.
Glyphs imported from Arev fonts are (c) Tavmjong Bah (see below).

Bitstream Vera Fonts Copyright (c) 2003 by Bitstream, Inc. All Rights Reserved.
Permission is hereby granted, free of charge, to any person obtaining a copy of
the fonts accompanying this license ("Fonts") and associated documentation files
(the "Font Software"), to reproduce and distribute the Font Software, including
without limitation the rights to use, copy, merge, publish, distribute, and/or
sell copies of the Font Software, and to permit persons to whom the Font Software
is furnished to do so, subject to the conditions in the full license.

Full text: https://dejavu-fonts.github.io/License.html
```
