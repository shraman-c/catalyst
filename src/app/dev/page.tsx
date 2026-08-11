import React from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Developers | Catalyst',
  description: 'About the developers and license for Catalyst.',
};

export default function DevPage() {
  const currentYear = new Date().getFullYear();

  return (
    <div className="min-h-screen flex flex-col">
      <nav className="nav-bar">
        <Link href="/" className="nav-logo">Catalyst</Link>
      </nav>

      <main className="flex-1 p-6 flex flex-col items-center">
        <div style={{ maxWidth: '800px', width: '100%' }}>
          
          <h1 className="text-display-lg mb-6 pb-2" style={{ borderBottom: 'var(--border-width) solid var(--ink)' }}>
            Developers
          </h1>
          
          <div className="bento-grid mb-6">
            <div className="bento-tile col-span-12 md:col-span-6 bento-tile-hoverable">
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px' }}>
                <div 
                  style={{ 
                    width: '64px', 
                    height: '64px', 
                    backgroundColor: 'var(--mono-panel)', 
                    border: 'var(--border-width) solid var(--ink)',
                    borderRadius: '50%',
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  title="Placeholder for Image"
                >
                  <img src="/shraman.jpeg" alt="Shraman Chaudhuri" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />

                  {/* TODO: Add image here, e.g. <img src="/shraman.jpg" alt="Shraman" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> */}
                </div>
                <div>
                  <h2 className="text-display-md">Shraman Chaudhuri</h2>
                  <div className="mt-1 text-body opacity-70">Co-Creator & Developer</div>
                </div>
              </div>
              
              <div className="flex gap-3" style={{ flexWrap: 'wrap' }}>
                <a href="https://github.com/shraman-c" className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }}>GitHub</a>
                <a href="https://www.linkedin.com/in/shramanchaudhuri/" className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }}>LinkedIn</a>
                <a href="https://shramanc.pages.dev" className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }}>Portfolio</a>
              </div>
            </div>

            <div className="bento-tile col-span-12 md:col-span-6 bento-tile-hoverable">
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px' }}>
                <div 
                  style={{ 
                    width: '64px', 
                    height: '64px', 
                    backgroundColor: 'var(--mono-panel)', 
                    border: 'var(--border-width) solid var(--ink)',
                    borderRadius: '50%',
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  title="Placeholder for Image"
                >
                 <img src="/spandan.jpg" alt="Spandan Dhar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />

                  {/* TODO: Add image here, e.g. <img src="/spandan.jpg" alt="Spandan" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> */}
                </div>
                <div>
                  <h2 className="text-display-md">Spandan Dhar</h2>
                  <div className="mt-1 text-body opacity-70">Co-Creator & Developer</div>
                </div>
              </div>
              
              <div className="flex gap-3" style={{ flexWrap: 'wrap' }}>
                <a href="#" className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }}>GitHub</a>
                <a href="#" className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }}>LinkedIn</a>
                <a href="#" className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }}>Portfolio</a>
              </div>
            </div>
          </div>

          <h2 className="text-display-lg mb-4 mt-6 pb-2" style={{ borderBottom: 'var(--border-width) solid var(--ink)' }}>
            License
          </h2>
          <div className="bento-tile-mono">
            <h3 className="text-display-md mb-2">MIT License</h3>
            <p className="text-body mb-4" style={{ fontWeight: 'bold' }}>
              Copyright (c) {currentYear} Shraman Chaudhuri and Spandan Dhar
            </p>
            <div className="text-body-sm opacity-70">
              <p className="mb-2">
                Permission is hereby granted, free of charge, to any person obtaining a copy
                of this software and associated documentation files (the "Software"), to deal
                in the Software without restriction, including without limitation the rights
                to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
                copies of the Software, and to permit persons to whom the Software is
                furnished to do so, subject to the following conditions:
              </p>
              <p className="mb-2">
                The above copyright notice and this permission notice shall be included in all
                copies or substantial portions of the Software.
              </p>
              <p>
                THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
                IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
                FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
                AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
                LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
                OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
                SOFTWARE.
              </p>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
