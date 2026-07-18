# Macro Day Tracker

A simple mobile-first macro tracker organized into **Breakfast, Lunch, and Dinner**. It is built as a static HTML/CSS/JavaScript app and is ready for GitHub Pages.

## What it does

- Tracks calories, protein, carbohydrates, fat, sugar, and fiber for every food entry
- Saves one optional body-weight entry for each date
- Shows the latest weight, seven-day average, change, and a recent trend chart
- Shows totals for each food, each meal, and the entire day
- Uses a food name plus protein, carbs, and fat, with optional sugar and fiber; calories calculate automatically
- Allows label calories to be entered when they differ from the macro calculation
- Saves every change automatically in IndexedDB
- Maintains a second recovery copy in localStorage
- Supports downloadable JSON backups and restoration
- Exports the complete macro and weight history to CSV
- Remembers recent foods for one-tap reuse
- Includes optional daily goals for calories, protein, carbs, fat, sugar, and fiber
- Works offline after the first visit and can be installed as a web app

## Important data note

The app stores macro and weight data locally on the device and browser where it is used. IndexedDB plus the recovery copy protects against ordinary closing and reopening, but clearing browser data or losing the device can remove both local copies. Use **Data & backup → Download backup** periodically for a portable copy.

## Publish with GitHub Pages

1. Create a new public GitHub repository, such as `Macro-Day-Tracker`.
2. Upload every file in this folder to the root of the repository.
3. Open **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Select the `main` branch and `/ (root)`, then save.
6. GitHub will provide the live URL after deployment.

## Files

- `index.html` — app structure
- `style.css` — responsive interface
- `script.js` — tracking, calculations, history, backups, and persistence
- `manifest.json` — installable web app settings
- `sw.js` — offline support
- `icon.svg` — app icon
