export const THEME_STORAGE_KEY = "eureka.theme";

// Runs before first paint: a stored choice wins, then the system preference.
export const themeInitScript = `(function(){try{var s=localStorage.getItem("${THEME_STORAGE_KEY}");var d=s==="board"||(s!=="paper"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;
