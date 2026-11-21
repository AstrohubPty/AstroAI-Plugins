# Constellation map style

The agent map as a night sky: loops are stars joined to a glowing core by faint lines, with a small arc per stage, an amber
ring when something waits on you, and streaks flying into the core when a run finishes.

A map style is a script, and it can only draw. It runs in a sandboxed frame with no network and no access to the page or your
data (AstroAI hands it a canvas and a plain-data picture of the map each frame), so installing one asks for nothing and needs no
restart. Pick it in Settings → Appearance → Agent map. To write your own, copy `constellation.js`: the comment at the top lists
what the script is given.

AstroAI keeps a copy of this folder in `vendor/plugins/map-styles-constellation` for its own tests and for simulate's demo;
change it here first, then refresh that copy.
