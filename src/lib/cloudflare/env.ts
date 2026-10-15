import { env } from 'cloudflare:workers';
import { siteOrigin } from '../seo/meta';
import { indexingAllowed } from '../seo/robots';

export function getDbBinding(): D1Database {
  const database = env.DB;
  if (!database) {
    throw new Error('Thiếu binding D1 (DB). Kiểm tra wrangler.jsonc.');
  }
  return database;
}

export function getSiteOrigin(requestOrigin: string): string {
  return siteOrigin(requestOrigin, configuredSiteUrl());
}

export function requestAllowsIndexing(requestOrigin: string): boolean {
  return indexingAllowed({ requestOrigin, siteUrl: configuredSiteUrl(), environment: configuredEnvironment() });
}

function configuredSiteUrl(): string {
  return readEnvString('SITE_URL');
}

function configuredEnvironment(): string {
  return readEnvString('ENVIRONMENT');
}

function readEnvString(key: 'SITE_URL' | 'ENVIRONMENT'): string {
  try {
    const value = (env as { SITE_URL?: unknown; ENVIRONMENT?: unknown })[key];
    return typeof value === 'string' ? value : '';
  } catch {
    return '';
  }
}

export function getMediaBucket(): R2Bucket {
  const bucket = env.MEDIA;
  if (!bucket) {
    throw new Error('Thiếu binding R2 (MEDIA). Kiểm tra wrangler.jsonc.');
  }
  return bucket;
}

export function optionalMediaBucket(): R2Bucket | null {
  try {
    return getMediaBucket();
  } catch {
    return null;
  }
}
