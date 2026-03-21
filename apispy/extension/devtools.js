// devtools.js — registers the APISpy DevTools panel
// Runs in the DevTools context (devtools_page).

chrome.devtools.panels.create(
  "APISpy",          // panel title shown in DevTools tab bar
  "icons/icon16.png", // icon shown next to the tab
  "panel.html",      // the panel page
  function (panel) {
    // panel is a chrome.devtools.panels.ExtensionPanel
    // Future: attach panel shown/hidden listeners here if needed
    void panel;
  }
);
