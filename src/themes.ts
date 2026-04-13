import bgMeadowMist from './assets/tilable-bg.png';
import bgVeiledCanopy from './assets/tilable-bg-1.png';
import bgJadeGarden from './assets/tilable-bg-2.png';
import bgEmberDrift from './assets/tilable-bg-3.png';

export interface Theme {
  id: string;
  name: string;
  image: string;
  preview: string;
}

export const themes: Theme[] = [
  { id: 'meadow-mist', name: 'Meadow Mist', image: bgMeadowMist, preview: bgMeadowMist },
  { id: 'veiled-canopy', name: 'Veiled Canopy', image: bgVeiledCanopy, preview: bgVeiledCanopy },
  { id: 'jade-garden', name: 'Jade Garden', image: bgJadeGarden, preview: bgJadeGarden },
  { id: 'ember-drift', name: 'Ember Drift', image: bgEmberDrift, preview: bgEmberDrift },
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
