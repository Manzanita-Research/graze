#!/usr/bin/env node

const BASE_URL = process.env.GRAZE_URL ?? "http://localhost:3737";
const CLEAN_ONLY = process.argv.includes("--clean");

const fixedShapes = [
  {
    id: "codex-live-smoke-title",
    type: "text",
    x: 1800,
    y: 120,
    layout: "heading",
    style: "idea",
    props: {
      richText: "Codex live canvas smoke",
    },
  },
  {
    id: "codex-live-smoke-note",
    type: "note",
    x: 1800,
    y: 250,
    layout: "compact",
    style: "question",
    props: {
      richText:
        "A compact note should stay readable and avoid the old overflowing-label look.",
    },
  },
  {
    id: "codex-live-smoke-card",
    type: "geo",
    x: 2140,
    y: 250,
    layout: "card",
    style: "success",
    props: {
      richText: "Card layout",
    },
  },
  {
    id: "codex-live-smoke-arrow",
    type: "arrow",
    x: 2050,
    y: 500,
    layout: "wide",
    style: "muted",
    props: {
      richText: "points to",
    },
  },
  {
    id: "codex-live-smoke-update-target",
    type: "geo",
    x: 2260,
    y: 470,
    layout: "compact",
    style: "warning",
    props: {
      richText: "before update",
    },
  },
];

const autoShapes = [
  {
    id: "codex-live-smoke-auto-heading",
    type: "text",
    layout: "heading",
    style: "idea",
    props: {
      richText: "Auto-placed heading",
    },
  },
  {
    id: "codex-live-smoke-auto-note",
    type: "note",
    layout: "compact",
    style: "question",
    props: {
      richText: "Auto-placement should choose a different open slot.",
    },
  },
];

const transientShape = {
  id: "codex-live-smoke-delete-me",
  type: "geo",
  x: 2520,
  y: 470,
  layout: "compact",
  style: "muted",
  props: {
    richText: "temporary",
  },
};

const smokeIds = [
  ...fixedShapes,
  ...autoShapes,
  transientShape,
].map((shape) => shape.id);

function shapeId(id) {
  return id.startsWith("shape:") ? id : `shape:${id}`;
}

async function api(path, options = {}) {
  const res = await fetch(new URL(path, BASE_URL), {
    ...options,
    headers: {
      "content-type": "application/json",
      ...options.headers,
    },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`${options.method ?? "GET"} ${path} -> ${res.status}: ${text}`);
  }
  return body;
}

async function createShape(shape) {
  const body = await api("/api/canvas/create_shape", {
    method: "POST",
    body: JSON.stringify(shape),
  });
  if (!body?.shape?.id) {
    throw new Error(`create_shape returned no shape for ${shape.id}`);
  }
  return body.shape;
}

async function deleteShapes(ids) {
  return api("/api/canvas/delete_shapes", {
    method: "POST",
    body: JSON.stringify({ shapeIds: ids.map(shapeId) }),
  });
}

async function main() {
  await deleteShapes(smokeIds);
  if (CLEAN_ONLY) {
    console.log(`Cleaned ${smokeIds.length} live smoke shape ids from ${BASE_URL}`);
    return;
  }

  const created = [];
  for (const shape of fixedShapes) {
    created.push(await createShape(shape));
  }
  for (const shape of autoShapes) {
    created.push(await createShape(shape));
  }

  const transient = await createShape(transientShape);
  await api("/api/canvas/update_shape", {
    method: "POST",
    body: JSON.stringify({
      shapeId: "codex-live-smoke-update-target",
      props: {
        color: "green",
        fill: "solid",
        richText: "updated OK",
      },
    }),
  });
  await deleteShapes([transient.id]);

  const shapes = await api("/api/canvas/shapes");
  const byId = new Map(shapes.shapes.map((shape) => [shape.id, shape]));
  const missing = smokeIds
    .filter((id) => id !== transientShape.id)
    .filter((id) => !byId.has(shapeId(id)));
  const stillPresent = byId.has(shapeId(transientShape.id));
  if (missing.length > 0) {
    throw new Error(`Missing smoke shapes: ${missing.join(", ")}`);
  }
  if (stillPresent) {
    throw new Error(`${transientShape.id} was not deleted`);
  }

  const autoHeading = byId.get(shapeId("codex-live-smoke-auto-heading"));
  const autoNote = byId.get(shapeId("codex-live-smoke-auto-note"));
  if (!Number.isFinite(autoHeading.x) || !Number.isFinite(autoHeading.y)) {
    throw new Error("Auto heading did not receive finite coordinates");
  }
  if (autoHeading.x === autoNote.x && autoHeading.y === autoNote.y) {
    throw new Error("Auto-placed smoke shapes landed on the same coordinates");
  }

  await api("/api/canvas/move_viewport", {
    method: "POST",
    body: JSON.stringify({ x: 1740, y: 80, zoom: 0.75 }),
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl: BASE_URL,
        created: created.map((shape) => ({
          id: shape.id,
          type: shape.type,
          x: shape.x,
          y: shape.y,
        })),
        updated: shapeId("codex-live-smoke-update-target"),
        deleted: transient.id,
        totalShapes: shapes.shapes.length,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
