import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { PaperSummary, PageTranslation } from '../types';

interface ScholarDB extends DBSchema {
  files: {
    key: string; // fingerprint
    value: {
      fingerprint: string;
      name: string;
      summary: PaperSummary;
      fullText?: string;
      createdAt: number;
    };
  };
  translations: {
    key: string; // fingerprint_pageNum
    value: {
      id: string;
      fingerprint: string;
      pageNumber: number;
      data: PageTranslation;
      createdAt: number;
    };
    indexes: { 'by-fingerprint': string };
  };
}

const DB_NAME = 'ScholarScrollDB';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<ScholarDB>> | null = null;

const getDB = () => {
  if (!dbPromise) {
    dbPromise = openDB<ScholarDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('files')) {
          db.createObjectStore('files', { keyPath: 'fingerprint' });
        }
        if (!db.objectStoreNames.contains('translations')) {
          const store = db.createObjectStore('translations', { keyPath: 'id' });
          store.createIndex('by-fingerprint', 'fingerprint');
        }
      },
    });
  }
  return dbPromise;
};

export const generateFingerprint = async (file: File): Promise<string> => {
  // Simple fingerprint: name + size + lastModified
  // Ideally use a hash of the first 1kb of the file for better accuracy but this is fast
  return `${file.name}_${file.size}_${file.lastModified}`;
};

export const saveSummary = async (fingerprint: string, name: string, summary: PaperSummary, fullText?: string) => {
  const db = await getDB();
  await db.put('files', {
    fingerprint,
    name,
    summary,
    fullText,
    createdAt: Date.now()
  });
};

export const getSummary = async (fingerprint: string) => {
  const db = await getDB();
  return db.get('files', fingerprint);
};

export const savePageTranslation = async (fingerprint: string, pageNumber: number, data: PageTranslation) => {
  const db = await getDB();
  const id = `${fingerprint}_${pageNumber}`;
  await db.put('translations', {
    id,
    fingerprint,
    pageNumber,
    data,
    createdAt: Date.now()
  });
};

export const getPageTranslation = async (fingerprint: string, pageNumber: number) => {
  const db = await getDB();
  const id = `${fingerprint}_${pageNumber}`;
  const record = await db.get('translations', id);
  return record ? record.data : null;
};
