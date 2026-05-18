import React from 'react';

export function SatoriTemplate({ title, subtitle }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        width: '800px',
        height: '400px',
        backgroundColor: '#0f172a',
        color: '#f8fafc',
        fontFamily: 'Roboto, sans-serif',
        padding: '40px',
        boxSizing: 'border-box',
      }}
    >
      <h1 style={{ fontSize: '48px', margin: '0 0 16px 0', color: '#38bdf8' }}>
        {title || 'Default Title'}
        <hr/>
        EOF-again.. Okay let's useEffect

      </h1>
      <p style={{ fontSize: '20px', margin: 0, color: '#94a3b8' }}>
        {subtitle || 'Iterate here with instant live refresh.'}
      </p>
    </div>
  );
}
