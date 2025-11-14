import { supabase } from '@/integrations/supabase/client';

export async function importTracksFromCSV(csvContent: string, batchSize: number = 1000) {
  try {
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/import-csv-tracks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify({
        csv_content: csvContent,
        batch_size: batchSize,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Import failed');
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error('Import error:', error);
    throw error;
  }
}

// Direct import function using Supabase client (for smaller datasets)
export async function directImportTracks(tracks: any[]) {
  const batchSize = 1000;
  let inserted = 0;
  let errors = 0;

  for (let i = 0; i < tracks.length; i += batchSize) {
    const batch = tracks.slice(i, i + batchSize);
    
    const { error } = await supabase
      .from('tracks')
      .upsert(batch, { onConflict: 'id' });
    
    if (error) {
      console.error(`Batch ${i}-${i + batchSize} error:`, error);
      errors += batch.length;
    } else {
      inserted += batch.length;
    }
  }

  return { inserted, errors, total: tracks.length };
}

// Parse CSV file
export function parseCSV(csvContent: string) {
  const lines = csvContent.trim().split('\n');
  const headers = lines[0].split(',');
  
  const tracks: any[] = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    
    if (values.length < headers.length) continue;
    
    const track = {
      id: values[0],
      youtube_id: values[1] || null,
      title: values[2] || 'Unknown',
      artist: values[3] || 'Unknown',
      cover_url: values[4] || null,
      duration: values[5] && values[5] !== 'null' ? parseInt(values[5]) : null,
      created_at: values[7] || new Date().toISOString(),
    };
    
    tracks.push(track);
  }
  
  return tracks;
}
