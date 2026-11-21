# AstroAI plugins

The plugin registry for [AstroAI](https://github.com/AstrohubPty/AstroAI), and the plugins in it.

- `registry.json` is the list AstroAI reads (**Settings → Plugins → Browse**, or `astroai plugin search`).
- `plugins/<id>/` is one plugin: a `plugin.yaml` and what it provides (loops, or an integration).

## Using it

Add the registry to AstroAI's `local/config.yaml`:

```yaml
plugins:
  registries:
    - https://raw.githubusercontent.com/AstrohubPty/AstroAI-Plugins/main/registry.json
```

This works once this repository is public: AstroAI fetches the list and clones plugins over plain https with no
sign-in. Then `npm run astroai -- plugin install <id>` shows exactly what the plugin asks for and waits for a yes.

## Adding a plugin

1. Put it in `plugins/<id>/` (see [Plugins](https://github.com/AstrohubPty/AstroAI/blob/main/docs/plugins.md)). Ask for as little as you can.
2. Commit it. Note that commit's full 40-character hash: a listing pins the exact commit, so what people install is what was reviewed.
3. Add an entry to `registry.json`, with the permissions the plugin's own `plugin.yaml` asks for (AstroAI refuses a plugin that asks for more than its listing says):

```json
{
  "id": "my-plugin",
  "name": "My plugin",
  "version": "1.0.0",
  "type": "loop",
  "description": "One sentence.",
  "author": "AstroHub",
  "permissions": { "network": [], "exec": [] },
  "source": { "git": "https://github.com/AstrohubPty/AstroAI-Plugins", "commit": "<the commit from step 2>", "path": "plugins/my-plugin" }
}
```

4. A new version is a new commit, a new `version` and a new `commit` in the same entry.

Try a plugin before listing it: `npm run astroai -- plugin install ./plugins/my-plugin` from the AstroAI folder.
