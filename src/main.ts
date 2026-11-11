import './styles.css';
import { BeatApp } from './app';

const root = document.querySelector<HTMLDivElement>('#app');

if (!root) {
  throw new Error('missing #app root');
}

const app = new BeatApp(root);
app.start();

if (import.meta.hot) {
  import.meta.hot.dispose(() => app.destroy());
}

