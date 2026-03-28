# Skill: Purity MCP Tools (Future)

This documents the MCP (Model Context Protocol) tool surface for Purity.
These tools would allow AI agents to scaffold, analyze, and modify Purity projects.

## Planned MCP Tools

### purity.scaffold
Create a new Purity project or component.
```json
{
  "name": "purity.scaffold",
  "description": "Create a new Purity project or component",
  "parameters": {
    "type": { "enum": ["project", "component"] },
    "name": { "type": "string" },
    "props": { "type": "object", "description": "Component props schema" },
    "slots": { "type": "array", "description": "Slot names" }
  }
}
```

### purity.analyze
Analyze a Purity component for issues.
```json
{
  "name": "purity.analyze",
  "description": "Analyze a Purity component for reactivity issues, memory leaks, and best practices",
  "parameters": {
    "file": { "type": "string", "description": "Path to component file" }
  }
}
```

### purity.compile
Preview what the AOT compiler outputs for a template.
```json
{
  "name": "purity.compile",
  "description": "Show the compiled output for an html template",
  "parameters": {
    "template": { "type": "string", "description": "The html`` template string" }
  }
}
```

### purity.migrate
Migrate code from another framework to Purity.
```json
{
  "name": "purity.migrate",
  "description": "Convert a React/Vue/Svelte component to Purity",
  "parameters": {
    "source": { "type": "string", "description": "Source framework (react, vue, svelte)" },
    "code": { "type": "string", "description": "The component code to migrate" }
  }
}
```

## Migration Mappings

### React → Purity
```
useState(init)           → state(init)
useMemo(fn, deps)        → compute(fn)
useEffect(fn, deps)      → watch(fn) + onDispose
useRef(init)             → { current: init }
<Component prop={val}>   → <p-component :prop=${val}>
onClick={fn}             → @click=${fn}
{cond && <X/>}           → when(() => cond, () => html`<X/>`)
{arr.map(x => <X/>)}    → each(() => arr, x => html`<X/>`)
```

### Vue 3 → Purity
```
ref(init)                → state(init)
computed(fn)             → compute(fn)
watch(src, cb)           → watch(src, cb)
watchEffect(fn)          → watch(fn)
v-if                     → when()
v-for                    → each()
v-model                  → ::prop
v-bind:prop              → :prop
@event                   → @event (same!)
<slot>                   → slot()
provide/inject           → @purity/inject
```

### Svelte 5 → Purity
```
$state(init)             → state(init)
$derived(expr)           → compute(() => expr)
$effect(fn)              → watch(fn)
{#if cond}               → when()
{#each arr}              → each()
bind:value               → ::value
on:click                 → @click
<slot>                   → slot()
```
