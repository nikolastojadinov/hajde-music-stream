-- SQL script za dodavanje playlisti u različitim kategorijama
-- Pokreni ovo u Supabase SQL Editor

-- Dodaj featured playliste
INSERT INTO playlists (title, description, category, image_url) VALUES
('Rock Legends', 'Klasični rock hitovi kroz decade', 'featured', 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=300&h=300&fit=crop'),
('Jazz Classics', 'Najbolji jazz standardi', 'featured', 'https://images.unsplash.com/photo-1511379938547-c1f69419868d?w=300&h=300&fit=crop'),
('Electronic Essentials', 'Must-have elektronska muzika', 'featured', 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=300&h=300&fit=crop'),
('Hip Hop Classics', 'Najbolji hip hop svih vremena', 'featured', 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=300&h=300&fit=crop');

-- Dodaj recent playliste
INSERT INTO playlists (title, description, category, image_url) VALUES
('Moja Plejlista #1', '50 omiljenih pesama', 'recent', 'https://images.unsplash.com/photo-1611339555312-e607c8352fd7?w=300&h=300&fit=crop'),
('Road Trip Mix', 'Savršena muzika za putovanje', 'recent', 'https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=300&h=300&fit=crop'),
('Summer Hits 2024', 'Letnji hitovi godine', 'recent', 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=300&h=300&fit=crop'),
('Evening Jazz', 'Opuštajući zvuci za večer', 'recent', 'https://images.unsplash.com/photo-1511379938547-c1f69419868d?w=300&h=300&fit=crop'),
('Morning Coffee', 'Jutarnja inspiracija', 'recent', 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=300&h=300&fit=crop'),
('Night Drive', 'Noćna vožnja playlist', 'recent', 'https://images.unsplash.com/photo-1519638399535-1b036603ac77?w=300&h=300&fit=crop');

-- Dodaj popular playliste
INSERT INTO playlists (title, description, category, image_url) VALUES
('Trending Now', 'Najslušanije pesme trenutno', 'popular', 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=300&h=300&fit=crop'),
('Viral TikTok Hits', 'Pesme koje su postale viralne', 'popular', 'https://images.unsplash.com/photo-1611339555312-e607c8352fd7?w=300&h=300&fit=crop'),
('Global Charts', 'Svetske top liste', 'popular', 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=300&h=300&fit=crop'),
('New Releases', 'Najnovija muzika', 'popular', 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=300&h=300&fit=crop'),
('Rising Stars', 'Nove zvezde muzičke scene', 'popular', 'https://images.unsplash.com/photo-1511379938547-c1f69419868d?w=300&h=300&fit=crop'),
('Radio Hits', 'Najpopularniji radio hitovi', 'popular', 'https://images.unsplash.com/photo-1519638399535-1b036603ac77?w=300&h=300&fit=crop');

-- Dodaj mood playliste
INSERT INTO playlists (title, description, category, image_url) VALUES
('Happy Vibes', 'Pesme koje podignu raspoloženje', 'mood', 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=300&h=300&fit=crop'),
('Chill & Relax', 'Za opuštanje i odmor', 'mood', 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=300&h=300&fit=crop'),
('Workout Energy', 'Motivacija za vežbanje', 'mood', 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=300&h=300&fit=crop'),
('Romantic Evening', 'Romantične melodije', 'mood', 'https://images.unsplash.com/photo-1511379938547-c1f69419868d?w=300&h=300&fit=crop'),
('Study Focus', 'Koncentracija i fokus', 'mood', 'https://images.unsplash.com/photo-1519638399535-1b036603ac77?w=300&h=300&fit=crop'),
('Melancholy', 'Za melanholične trenutke', 'mood', 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=300&h=300&fit=crop');

-- Dodaj genre playliste
INSERT INTO playlists (title, description, category, image_url) VALUES
('Rock Essentials', 'Najbolji rock hitovi', 'genre', 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=300&h=300&fit=crop'),
('Electronic Beats', 'Elektronska muzika za svaki ukus', 'genre', 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=300&h=300&fit=crop'),
('Hip Hop Nation', 'Hip hop kultura i muzika', 'genre', 'https://images.unsplash.com/photo-1611339555312-e607c8352fd7?w=300&h=300&fit=crop'),
('Country Roads', 'Najbolji kantri hitovi', 'genre', 'https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=300&h=300&fit=crop'),
('Classical Masters', 'Klasična muzika velikana', 'genre', 'https://images.unsplash.com/photo-1507838153414-b4b713384a76?w=300&h=300&fit=crop'),
('Latin Rhythms', 'Latino ritmovi i plesovi', 'genre', 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=300&h=300&fit=crop'),
('Blues & Soul', 'Duboki blues i soul', 'genre', 'https://images.unsplash.com/photo-1511379938547-c1f69419868d?w=300&h=300&fit=crop'),
('Indie Vibes', 'Nezavisna muzika i umetnici', 'genre', 'https://images.unsplash.com/photo-1519638399535-1b036603ac77?w=300&h=300&fit=crop');

-- Proveri da li su playliste uspešno dodane
SELECT category, COUNT(*) as count FROM playlists GROUP BY category ORDER BY category;