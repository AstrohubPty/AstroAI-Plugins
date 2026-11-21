# Classic colour schemes

Three colour schemes for AstroAI: **Nord** (Material, dark), **Gruvbox** (HUD, dark) and **Solarized Light** (Material, light).

A theme is only colours: it has no code and no CSS, so installing one asks for nothing and needs no restart. AstroAI writes the
style rule itself from the colours here, and refuses a scheme whose text can't be read (4.5:1 on the panel colour).
Pick one in Settings → Appearance. To make your own, copy `theme.yaml` and change the colours.

AstroAI keeps a copy of this folder in `vendor/plugins/themes-classic` for its own tests and for simulate's demo; change it here
first, then refresh that copy.
