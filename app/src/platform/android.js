// Android niceties: status bar colours that follow the theme, the hardware
// back button closing whatever is on top (dialog → panel → window → app).
import { App as CapApp } from "@capacitor/app";
import { StatusBar, Style } from "@capacitor/status-bar";
import { SplashScreen } from "@capacitor/splash-screen";
import { Keyboard } from "@capacitor/keyboard";
import { store } from "../state/store.js";

export async function setupAndroid() {
  SplashScreen.hide().catch(() => {});
  const paint = async () => {
    const dark = document.documentElement.dataset.theme !== "light";
    await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => {});
    await StatusBar.setBackgroundColor({ color: dark ? "#07080f" : "#eef1f8" }).catch(() => {});
  };
  paint();
  new MutationObserver(paint).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  Keyboard.addListener("keyboardWillShow", () => document.body.classList.add("kb-open")).catch?.(() => {});
  Keyboard.addListener("keyboardWillHide", () => document.body.classList.remove("kb-open")).catch?.(() => {});

  CapApp.addListener("backButton", () => {
    const s = store.get();
    if (s.approvals.length) return s.approvals[0].resolve(false);
    if (s.dialog) return s.dialog.resolve ? s.dialog.resolve(null) : store.set({ dialog: null });
    if (s.palette) return store.set({ palette: false });
    if (s.windows.length) return store.set({ windows: s.windows.slice(0, -1) });
    if (s.panel) return store.set({ panel: null });
    CapApp.minimizeApp();
  });
}
