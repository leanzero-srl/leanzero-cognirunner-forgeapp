/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { readFile, writeFile } from 'node:fs/promises';
import { compileSite, projectRegistry } from '../lib/org-workflow-compiler.mjs';
const [planPath, metadataPath, outputPath] = process.argv.slice(2);
if (!planPath || !metadataPath || !outputPath) throw new Error('Usage: node org-workflow-compile.mjs PLAN.json METADATA.json OUTPUT.json');
const plan = JSON.parse(await readFile(planPath,'utf8'));
const metadata = JSON.parse(await readFile(metadataPath,'utf8'));
const result = compileSite(plan, metadata.site, metadata);
if (metadata.registry) result.registryProjection = projectRegistry(result.rows, metadata.registry.rows, metadata.registry);
await writeFile(outputPath, JSON.stringify(result,null,2) + '\n', {flag:'wx'});
console.log(JSON.stringify({site:result.site,rules:result.rows.length,blockers:result.blockers.length,status:result.status,outputPath}));
