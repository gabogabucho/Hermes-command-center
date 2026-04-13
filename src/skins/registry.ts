/**
 * Skin registry — add new skins here.
 *
 * Each skin maps to a `data-skin` attribute value applied to <html>.
 * CSS custom property overrides live in global.css under [data-skin="<id>"].
 */

export interface SkinDefinition {
  id: string;
  label: string;
  description: string;
}

export const SKINS: SkinDefinition[] = [
  {
    id: 'amber',
    label: 'AMBER',
    description: 'Default ops theme — orange/amber accents on deep navy',
  },
  {
    id: 'cyber',
    label: 'CYBER',
    description: 'Cyberpunk hacker terminal — white-on-black with pixel frames',
  },
  {
    id: 'matrix',
    label: 'MATRIX',
    description: 'Classic green phosphor on black',
  },
];

export const DEFAULT_SKIN = 'amber';
