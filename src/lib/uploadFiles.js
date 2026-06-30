import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const BUCKET = 'lead-uploads';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILES = 5;

/**
 * Uploads an array of File objects to Supabase Storage.
 * @param {File[]} files
 * @param {string} formType  e.g. 'homeowner-consultation' or 'trade-estimate'
 * @returns {Promise<string[]>}  storage paths for each uploaded file
 */
export async function uploadFiles(files, formType) {
  if (!files || files.length === 0) return [];

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'File upload is not configured. Please email files to info@calibercabinetshop.com.',
    );
  }

  if (files.length > MAX_FILES) {
    throw new Error(`Please select up to ${MAX_FILES} files at a time.`);
  }

  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) {
      throw new Error(`"${file.name}" is too large. Files must be under 10MB.`);
    }
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const timestamp = Date.now();
  const paths = [];

  for (const file of files) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${formType}/${timestamp}-${safeName}`;

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { cacheControl: '3600', upsert: false });

    if (error) throw new Error(`Failed to upload "${file.name}": ${error.message}`);
    paths.push(path);
  }

  return paths;
}
