#!/usr/bin/env node

import { projectEnv } from "./lib/project-secrets.mjs";

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
    plot: parsed.get("plot") ?? "short"
  };
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
const apiKey = projectEnv("OMDB_API_KEY");

if (!apiKey) {
  throw new Error("OMDB_API_KEY was not found in App Configuration / Key Vault.");
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
