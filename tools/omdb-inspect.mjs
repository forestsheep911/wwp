#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, "..");

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = new Map();
  const ids = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      ids.push(arg);
      continue;
    }

    const [name, inlineValue] = arg.slice(2).split("=", 2);
    const value = inlineValue ?? args[index + 1];
    if (inlineValue === undefined) {
      index += 1;
    }
    parsed.set(name, value ?? "");
  }

  return {
    ids: ids.length ? ids : ["tt0080684"],
    envPath: parsed.get("env") ?? path.join(repoRoot, ".env"),
    plot: parsed.get("plot") ?? "short"
  };
}

async function readEnvValue(envPath, name) {
  const raw = await readFile(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || match[1] !== name) {
      continue;
    }

    return match[2].trim().replace(/^["']|["']$/g, "");
  }

  return process.env[name];
}

function selectFields(payload) {
  return {
    imdbID: payload.imdbID,
    title: payload.Title,
    year: payload.Year,
    type: payload.Type,
    rated: payload.Rated,
    runtime: payload.Runtime,
    genre: payload.Genre,
    director: payload.Director,
    actors: payload.Actors,
    language: payload.Language,
    country: payload.Country,
    awards: payload.Awards,
    boxOffice: payload.BoxOffice,
    production: payload.Production,
    totalSeasons: payload.totalSeasons,
    imdbRating: payload.imdbRating,
    imdbVotes: payload.imdbVotes,
    metascore: payload.Metascore,
    ratings: payload.Ratings,
    poster: payload.Poster,
    response: payload.Response,
    error: payload.Error
  };
}

const options = parseArgs();
const apiKey = await readEnvValue(options.envPath, "OMDB_API_KEY");

if (!apiKey) {
  throw new Error(`OMDB_API_KEY was not found in ${options.envPath} or process env.`);
}

for (const id of options.ids) {
  const url = new URL("https://www.omdbapi.com/");
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("i", id);
  url.searchParams.set("plot", options.plot);
  url.searchParams.set("r", "json");

  const response = await fetch(url);
  const payload = await response.json();
  console.log(JSON.stringify(selectFields(payload), null, 2));
}
