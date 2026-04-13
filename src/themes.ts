import bgMeadowMist from './assets/tilable-bg.png';
import bgVeiledCanopy from './assets/tilable-bg-1.png';
import bgJadeGarden from './assets/tilable-bg-2.png';
import bgEmberDrift from './assets/tilable-bg-3.png';

export interface Theme {
  id: string;
  name: string;
  image: string | null;
  color: string | null;
  preview: string | null;
}

export const themes: Theme[] = [
  { id: 'meadow-mist', name: 'Meadow Mist', image: bgMeadowMist, color: null, preview: bgMeadowMist },
  { id: 'veiled-canopy', name: 'Veiled Canopy', image: bgVeiledCanopy, color: null, preview: bgVeiledCanopy },
  { id: 'jade-garden', name: 'Jade Garden', image: bgJadeGarden, color: null, preview: bgJadeGarden },
  { id: 'ember-drift', name: 'Ember Drift', image: bgEmberDrift, color: null, preview: bgEmberDrift },
  { id: 'light', name: 'Light', image: null, color: '#ffffff', preview: null },
  { id: 'dark', name: 'Dark', image: null, color: '#121212', preview: null },
];

const STORAGE_KEY = 'hr-bpm-theme';

export function getThemeId(): string {
  return localStorage.getItem(STORAGE_KEY) ?? 'meadow-mist';
}

export function setThemeId(id: string) {
  localStorage.setItem(STORAGE_KEY, id);
}

export function getTheme(id?: string): Theme {
  const targetId = id ?? getThemeId();
  return themes.find((t) => t.id === targetId) ?? themes[0];
}
