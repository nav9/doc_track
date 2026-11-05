import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';

// Production only: register the precache service worker so the installed app
// opens without a network. Development keeps HMR and avoids stale caches.
if (import.meta.env.PROD) {
  void import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({
      immediate: true,
      onOfflineReady() {
        console.info('[DocTrack] Offline cache ready.');
      },
      onNeedRefresh() {
        console.info('[DocTrack] A new version is available and will load on the next visit.');
      }
    });
  });
}

const target = document.getElementById('app');
if (!target) throw new Error('Root element #app was not found');

const app = mount(App, { target });

export default app;
