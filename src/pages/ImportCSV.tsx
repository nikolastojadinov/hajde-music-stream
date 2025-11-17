import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { directImportTracks, parseCSV } from '@/utils/importCSV';
import { Upload, CheckCircle, XCircle } from 'lucide-react';

export default function ImportCSV() {
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [importResult, setImportResult] = useState<any>(null);
  const { toast } = useToast();

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    setProgress(0);
    setImportResult(null);

    try {
      const csvContent = await file.text();
      
      toast({
        title: 'Parsiranje CSV-a...',
        description: 'Molimo sačekajte...',
      });
      
      setProgress(25);
      
      const tracks = parseCSV(csvContent);
      
      toast({
        title: `Pronađeno ${tracks.length} pesama`,
        description: 'Započinjem uvoz...',
      });
      
      setProgress(50);
      
      const result = await directImportTracks(tracks);
      
      setProgress(100);
      setImportResult(result);
      
      toast({
        title: 'Uvoz završen!',
        description: `Uvezeno: ${result.inserted}, Greške: ${result.errors}`,
      });
      
    } catch (error) {
      console.error('Import error:', error);
      toast({
        title: 'Greška prilikom uvoza',
        description: error instanceof Error ? error.message : 'Nepoznata greška',
        variant: 'destructive',
      });
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="container mx-auto py-8 px-4">
      <Card className="max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle>Uvoz pesama iz CSV-a</CardTitle>
          <CardDescription>
            Izaberi CSV fajl sa pesmama da ih uvezem u bazu
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
            <input
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              disabled={isImporting}
              className="hidden"
              id="csv-upload"
            />
            <label
              htmlFor="csv-upload"
              className={`cursor-pointer flex flex-col items-center gap-4 ${
                isImporting ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            >
              <Upload className="w-12 h-12 text-muted-foreground" />
              <div>
                <p className="text-lg font-medium">
                  {isImporting ? 'Uvoz u toku...' : 'Klikni da izabereš CSV fajl'}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Podržani format: id, external_id, title, artist, cover_url, duration, source, created_at
                </p>
              </div>
            </label>
          </div>

          {isImporting && (
            <div className="space-y-2">
              <Progress value={progress} />
              <p className="text-sm text-center text-muted-foreground">
                {progress}% zavршeno
              </p>
            </div>
          )}

          {importResult && (
            <Card className={importResult.errors > 0 ? 'border-yellow-500' : 'border-green-500'}>
              <CardContent className="pt-6">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-5 h-5 text-foreground" />
                    <span className="font-medium">
                      Uspešno uvezeno: {importResult.inserted} pesama
                    </span>
                  </div>
                  
                  {importResult.errors > 0 && (
                    <div className="flex items-center gap-2">
                      <XCircle className="w-5 h-5 text-foreground" />
                      <span className="font-medium">
                        Greške: {importResult.errors}
                      </span>
                    </div>
                  )}
                  
                  <div className="text-sm text-muted-foreground">
                    Ukupno redova: {importResult.total}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
