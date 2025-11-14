import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TrackRow {
  id: string;
  external_id: string;
  title: string;
  artist: string;
  cover_url: string | null;
  duration: number | null;
  source: string | null;
  created_at: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { csv_content, batch_size = 100 } = await req.json();

    if (!csv_content) {
      throw new Error('CSV content is required');
    }

    // Parse CSV content
    const lines = csv_content.trim().split('\n');
    const headers = lines[0].split(',');
    
    const tracks: any[] = [];
    
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',');
      
      if (values.length < headers.length) continue;
      
      const track: any = {
        id: values[0],
        youtube_id: values[1] || null, // external_id maps to youtube_id
        title: values[2] || 'Unknown',
        artist: values[3] || 'Unknown',
        cover_url: values[4] || null,
        duration: values[5] && values[5] !== 'null' ? parseInt(values[5]) : null,
        created_at: values[7] || new Date().toISOString(),
      };
      
      tracks.push(track);
    }

    // Insert in batches
    let inserted = 0;
    let errors = 0;
    
    for (let i = 0; i < tracks.length; i += batch_size) {
      const batch = tracks.slice(i, i + batch_size);
      
      const { error } = await supabaseClient
        .from('tracks')
        .upsert(batch, { onConflict: 'id' });
      
      if (error) {
        console.error(`Batch ${i}-${i + batch_size} error:`, error);
        errors += batch.length;
      } else {
        inserted += batch.length;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Imported ${inserted} tracks, ${errors} errors`,
        total_rows: tracks.length,
        inserted,
        errors,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});
