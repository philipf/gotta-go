import satori from 'satori';
import React from 'react'; // Required for the JSX transform in a bare Node environment
import fs from 'fs/promises';

async function generateSVG() {
  // 1. Read the font file (ensure Roboto-Regular.ttf is still in your directory)
  const robotoArrayBuffer = await fs.readFile('./Roboto-Regular.ttf');

  // 2. Call Satori using JSX syntax
  const svg = await satori(
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        width: '100%',
        height: '100%',
        backgroundColor: '#1e1e2e', // Let's switch up the colors
        color: '#cdd6f4',
        fontSize: 64,
        fontWeight: 'bold',
        fontFamily: 'Roboto',
      }}
    >
      Hello, JSX World!
    </div>,
    // Configuration options remain exactly the same
    {
      width: 800,
      height: 400,
      fonts: [
        {
          name: 'Roboto',
          data: robotoArrayBuffer,
          weight: 400,
          style: 'normal',
        },
      ],
    }
  );

  // 3. Output the generated SVG
  await fs.writeFile('./hello-jsx.svg', svg);
  console.log('JSX SVG generated successfully! Check hello-jsx.svg');
}

generateSVG().catch(console.error);
