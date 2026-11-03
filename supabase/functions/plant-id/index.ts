// Putzplan – Pflanzenerkennung per Foto
//
//   POST /plant-id   multipart/form-data: images = Foto (JPEG/PNG), organs = auto|leaf|flower|fruit|bark
//                    → { results: [{ score, scientificName, genus, family, commonNames }], remaining }
//
// Leitet das Foto an Pl@ntNet weiter. Der API-Schlüssel liegt als Secret PLANTNET_API_KEY
// im Supabase-Projekt und steckt deshalb nicht in der App. Fotos werden hier nicht gespeichert.
// Ein Limit pro Gerät oder eine Bezahlschranke kann später hier eingebaut werden.

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MAX_BYTES = 6 * 1024 * 1024;
const ORGANS = ['auto', 'leaf', 'flower', 'fruit', 'bark'];
const TYPES = ['image/jpeg', 'image/png'];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

type PlantNetResult = {
  score: number;
  species?: {
    scientificNameWithoutAuthor?: string;
    genus?: { scientificNameWithoutAuthor?: string };
    family?: { scientificNameWithoutAuthor?: string };
    commonNames?: string[];
  };
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const key = Deno.env.get('PLANTNET_API_KEY');
  if (!key) return json({ error: 'not_configured' }, 503);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  const image = form.get('images');
  if (!(image instanceof File) || image.size === 0 || image.size > MAX_BYTES || !TYPES.includes(image.type)) {
    return json({ error: 'bad_image' }, 400);
  }
  const organ = String(form.get('organs') || 'auto');

  const out = new FormData();
  out.append('images', image, image.type === 'image/png' ? 'plant.png' : 'plant.jpg');
  out.append('organs', ORGANS.includes(organ) ? organ : 'auto');
  const url = 'https://my-api.plantnet.org/v2/identify/all'
    + `?api-key=${encodeURIComponent(key)}&lang=de&nb-results=5&include-related-images=false`;

  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', body: out });
  } catch (e) {
    console.error('Pl@ntNet nicht erreichbar', e);
    return json({ error: 'upstream' }, 502);
  }
  // 404 heißt bei Pl@ntNet: keine Pflanze erkannt.
  if (res.status === 404) return json({ results: [], remaining: null });
  if (!res.ok) {
    console.error('Pl@ntNet-Fehler', res.status, (await res.text()).slice(0, 300));
    const error = res.status === 401 || res.status === 403 ? 'key_invalid' : res.status === 429 ? 'quota' : 'upstream';
    return json({ error }, 502);
  }
  const data = await res.json();
  const results = ((data.results || []) as PlantNetResult[]).slice(0, 5).map((r) => ({
    score: r.score,
    scientificName: r.species?.scientificNameWithoutAuthor || '',
    genus: r.species?.genus?.scientificNameWithoutAuthor || '',
    family: r.species?.family?.scientificNameWithoutAuthor || '',
    commonNames: (r.species?.commonNames || []).slice(0, 3),
  }));
  return json({ results, remaining: data.remainingIdentificationRequests ?? null });
});
