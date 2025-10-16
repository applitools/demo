# External Dependencies Report

This document lists all external resources referenced in the HTML files of this project.

## Summary

The project contains references to external resources. Most pages work with local assets, but some pages require external resources to function properly.

## External Resources Found

### CDN Libraries

1. **Tailwind CSS**
   - File: `MobileEmulation/layout.html`
   - URL: `https://unpkg.com/tailwindcss@^1.0/dist/tailwind.min.css`
   - Type: CSS Framework

2. **Google Fonts**
   - Files: `index.html`, `AutonomousTestPages/index.html`, `DomSnapshot/google-font.html`
   - URLs:
     - `https://fonts.googleapis.com/css?family=Gloria+Hallelujah`
     - `https://fonts.googleapis.com/css2?family=Tangerine&display=swap`
   - Type: Web Fonts

3. **Marked.js** (Markdown Parser)
   - File: `changelog.html`
   - URL: `https://cdn.jsdelivr.net/npm/marked/marked.min.js`
   - Type: JavaScript Library

4. **React & Babel** (for logs.html)
   - File: `logs.html`
   - URLs:
     - `https://unpkg.com/react@18/umd/react.development.js`
     - `https://unpkg.com/react-dom@18/umd/react-dom.development.js`
     - `https://unpkg.com/@babel/standalone@7.10.3/babel.min.js`
   - Type: JavaScript Libraries

5. **Applitools Core Library**
   - File: `logs.html`
   - URL: `https://unpkg.com/@applitools/core@4.16.2/dist/troubleshoot/logs.js`
   - Type: JavaScript Library

6. **External CSS**
   - File: `logs.html`
   - URL: `https://noam-gaash.co.il/bio/main.css`
   - Type: CSS Stylesheet

### External Images

1. **Icon Resources**
   - Files: `AutonomousTestPages/AutoMaintenance/subfolder/page11.html`, `page12.html`
   - URL: `https://cdn.iconscout.com/icon/free/png-512/free-export-3114432-2598210.png`
   - Type: Image (PNG)

2. **Applitools Demo Images**
   - File: `DomSnapshot/ie.html`
   - URL: `https://cdn.jsdelivr.net/gh/applitools/demo@gh-pages/DomSnapshot/smurfs.jpg`
   - Type: Image (JPG)

### External API References

1. **Applitools Eyes API**
   - File: `eyes-browser.html`
   - URL: `https://eyes.applitools.com/`
   - Type: API Service

### Localhost References (Development)

Some files reference localhost URLs for testing purposes:
- `http://localhost:7374` (CORS testing)
- `http://localhost:7373` (inline frames testing)
- `https://localhost:1010` (CORS testing)

### GitHub Pages References

- Files in `TestPages/ShadowDOM/` reference:
  - `https://applitools.github.io/demo/css/reset.css`

## Impact Analysis

### Pages Without External Dependencies

Most test pages work entirely with local assets:
- Most pages in `TestPages/`
- Most pages in `DomSnapshot/`
- Most pages in `AutonomousTestPages/`

### Pages Requiring External Resources

The following pages require internet connectivity to function properly:

1. **index.html** - Uses Google Fonts (will work without it, but font will fall back)
2. **logs.html** - Requires React, Babel, and Applitools libraries
3. **changelog.html** - Requires Marked.js for markdown parsing
4. **MobileEmulation/layout.html** - Requires Tailwind CSS
5. **eyes-browser.html** - Requires Applitools API access
6. Pages with external images (subfolder/page11.html, page12.html)

## Recommendations

To make the project fully self-contained:

1. **Download and vendor external libraries:**
   - Download React, ReactDOM, Babel from unpkg
   - Download Marked.js from CDN
   - Download Tailwind CSS
   - Download Google Fonts files

2. **Replace external image URLs** with local copies

3. **Update HTML files** to reference local versions

4. **Mock or document API dependencies** like Applitools Eyes API

## Server Notes

The Express server serves all files as static content. External dependencies will still be fetched from their respective URLs when pages are loaded in a browser. If you need the pages to work completely offline, you'll need to download and vendor all external resources.
