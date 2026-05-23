import './styles.css';
import { BeatApp } from './app';
import { registerServiceWorker } from './pwa';

const root = document.querySelector<HTMLDivElement>('#app');

if (!root) {
  throw new Error('missing #app root');
}

const app = new BeatApp(root);
app.start();
registerServiceWorker();

if (import.meta.hot) {
  import.meta.hot.dispose(() => app.destroy());
}

