# Classic map styles

Nine ways to draw the agent map, beyond the two AstroAI comes with (Holo and Globe): **Radar**, **Synapse**, **Reactor**,
**Terminal**, **Spectrum**, **Singularity**, **Grid**, **Subway** and **Weather**.

A map style is a script, and it can only draw. Each runs in a sandboxed frame with no network and no access to the page or your
data, so installing this asks for nothing and needs no restart. Pick one in Settings → Appearance → Agent map. They keep what
the built-in styles had: hovering a ring or a session's satellite still shows its tip.

These files are AstroAI's own style code bundled as plain JavaScript (each one carries the small drawing helpers it uses, so
each stands alone). To write your own, start from the Constellation style, which is short.

AstroAI keeps a copy of this folder in `vendor/plugins/map-styles-classic` for its own tests and for simulate's demo; change it
here first, then refresh that copy.
