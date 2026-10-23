export const THEME_STORAGE_KEY = "eureka.theme";

// Runs before first paint: the board only on a stored choice, paper otherwise.
export const themeInitScript = `(function(){try{var s=localStorage.getItem("${THEME_STORAGE_KEY}");var d=s==="board";document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;
