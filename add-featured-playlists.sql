-- SQL script za dodavanje tačnih featured playlisti sa specifičnim ID-jevima
-- Pokreni ovo u Supabase SQL Editor

-- Obriši postojeće playliste sa ovim ID-jevima ako postoje
DELETE FROM playlists WHERE id IN (
  '7ee9ab59-ed8b-4afc-948b-9ab01b8d25cc',
  'b176d691-9f3a-4965-900c-51df898a01ca',
  '940157cd-e749-4401-84ea-c5e923f75768',
  '919bc5f5-71ec-423d-81a3-f7a22aa05ca7',
  'bec4dca2-2b80-41f6-82c8-0dc056c9cd82',
  'b4506e1a-5141-4a2a-8460-84ef97c96ec7',
  '8add5f32-ef1a-406d-bbf9-4d028337c59b',
  'd46c18a1-c0bd-4be8-8aeb-039d0dfe82df'
);

-- Dodaj featured playliste sa tačnim ID-jevima
INSERT INTO playlists (id, title, description, cover_url, category) VALUES
('7ee9ab59-ed8b-4afc-948b-9ab01b8d25cc', 'Rock Legends', 'Klasični rock hitovi kroz decade', 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=300&h=300&fit=crop', 'featured'),
('b176d691-9f3a-4965-900c-51df898a01ca', 'Jazz Classics', 'Najbolji jazz standardi', 'https://images.unsplash.com/photo-1511379938547-c1f69419868d?w=300&h=300&fit=crop', 'featured'),
('940157cd-e749-4401-84ea-c5e923f75768', 'Electronic Essentials', 'Must-have elektronska muzika', 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=300&h=300&fit=crop', 'featured'),
('919bc5f5-71ec-423d-81a3-f7a22aa05ca7', 'Hip Hop Classics', 'Najbolji hip hop svih vremena', 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=300&h=300&fit=crop', 'featured'),
('bec4dca2-2b80-41f6-82c8-0dc056c9cd82', 'Pop Hits 2024', 'Najveći pop hitovi godine', 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=300&h=300&fit=crop', 'featured'),
('b4506e1a-5141-4a2a-8460-84ef97c96ec7', 'Chill Vibes', 'Opuštajuća muzika za relaks', 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=300&h=300&fit=crop', 'featured'),
('8add5f32-ef1a-406d-bbf9-4d028337c59b', 'Dance Floor', 'Plesni hitovi za žurku', 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=300&h=300&fit=crop', 'featured'),
('d46c18a1-c0bd-4be8-8aeb-039d0dfe82df', 'Alternative Rock', 'Najbolji alternativni rock', 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=300&h=300&fit=crop', 'featured');

-- Proveri da li su dodane
SELECT id, title, cover_url FROM playlists WHERE id IN (
  '7ee9ab59-ed8b-4afc-948b-9ab01b8d25cc',
  'b176d691-9f3a-4965-900c-51df898a01ca',
  '940157cd-e749-4401-84ea-c5e923f75768',
  '919bc5f5-71ec-423d-81a3-f7a22aa05ca7',
  'bec4dca2-2b80-41f6-82c8-0dc056c9cd82',
  'b4506e1a-5141-4a2a-8460-84ef97c96ec7',
  '8add5f32-ef1a-406d-bbf9-4d028337c59b',
  'd46c18a1-c0bd-4be8-8aeb-039d0dfe82df'
);