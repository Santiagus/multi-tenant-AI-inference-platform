---
name: react
description: React/TypeScript product dashboard conventions and the boundary with Grafana.
---

# React

- React + TypeScript for product-facing UI.
- Infrastructure/operational dashboards stay in Grafana.
- React exposes user-facing jobs, routing, usage and economics; it does not duplicate Grafana dashboards.
- Clean link typography: Never insert decorative Unicode arrow characters (such as `↗`, `➜`, `➔`, `➡`) when adding links. Format links cleanly using semantic HTML, consistent font weights, standard text, or subtle underline/dotted borders without decorative noise glyphs.
