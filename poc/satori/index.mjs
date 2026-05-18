import satori from 'satori';
import fs from 'fs/promises';

async function generateSVG() {
  // 1. Read the font file into a buffer
  const robotoArrayBuffer = await fs.readFile('./Roboto-Regular.ttf');

  // 2. Call Satori with your layout and options
  const svg = await satori(
    // HTML/Layout structure (Plain Object API)
    {
      type: 'div',
      props: {
        children: 'Hello, World!',
        style: {
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          width: '100%',
          height: '100%',
          backgroundColor: '#f0f4f8',
          color: '#333333',
          fontSize: 64,
          fontWeight: 'bold',
        },
      },
    },
    // Configuration options
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
  await fs.writeFile('./hello-world.svg', svg);
  console.log('SVG generated successfully! Check hello-world.svg');
}

generateSVG().catch(console.error);
