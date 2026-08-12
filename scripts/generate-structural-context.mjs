#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { buildStructuralContextDataset } from '../backend/src/structural-context.mjs';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  const source = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  if (quoted) throw new Error('unterminated quoted CSV field');
  if (rows.length === 0) return [];

  const headers = rows[0];
  return rows.slice(1).filter((values) => values.some(Boolean)).map((values) => {
    if (values.length !== headers.length) throw new Error('CSV row width does not match header');
    return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
  });
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, `file://${repositoryRoot}/`), 'utf8'));
}

const zones = await readJson('public/data/admin-dongs.geojson');
const mapValidation = await readJson('public/data/validation.json');
const welfareValidation = await readJson(
  'data/processed/welfare_basic_livelihood_2024_validation.json',
);
const welfareRows = parseCsv(await readFile(
  new URL('data/processed/welfare_basic_livelihood_2024_current_dong_mapping.csv', `file://${repositoryRoot}/`),
  'utf8',
));

const dataset = buildStructuralContextDataset({
  zones,
  welfareRows,
  sourceValidation: {
    map_data_status: mapValidation.status,
    geometry_zones: mapValidation.counts.adminDongs,
    current_admin_dongs: zones.features.reduce(
      (count, feature) => count + feature.properties.current_admin_dong_codes_20260701.length,
      0,
    ),
    welfare_current_dongs: welfareValidation.current_admin_dong_count,
    welfare_assignable_current_dongs: welfareValidation.current_one_to_one_covered_count,
    welfare_split_unresolved_current_dongs: welfareValidation.current_split_unresolved_count,
  },
});

if (dataset.zone_count !== 156 || dataset.current_admin_dong_count !== 162) {
  throw new Error(
    `geography regression: expected 156 zones/162 current dongs, got ${dataset.zone_count}/${dataset.current_admin_dong_count}`,
  );
}
if (dataset.source_validation.map_data_status !== 'pass') {
  throw new Error('curated map data validation must pass before structural context generation');
}

const outputPath = new URL('public/data/structural-context.json', `file://${repositoryRoot}/`);
await writeFile(outputPath, `${JSON.stringify(dataset)}\n`, 'utf8');
process.stdout.write(
  `generated structural context: ${dataset.zone_count} zones, ${dataset.current_admin_dong_count} current dongs\n`,
);
