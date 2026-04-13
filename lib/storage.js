// Helpers around the Supabase Storage 'invoices' bucket.

const BUCKET = 'invoices';

const slug = (s) =>
  String(s || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'unknown';

// Builds a stable, collision-resistant path:
//   {vendor-slug}/{store-slug}/{YYYY-MM-DD}-{rand}.{ext}
function buildPath(storeName, vendorName, date, file) {
  const ext = (file?.name?.split('.').pop() || 'jpg').toLowerCase();
  const safeExt = /^(jpe?g|png|webp|heic)$/i.test(ext) ? ext : 'jpg';
  const rand = Math.random().toString(36).slice(2, 10);
  return `${slug(vendorName)}/${slug(storeName)}/${date}-${rand}.${safeExt}`;
}

export async function uploadInvoice(supabase, file, { storeName, vendorName, date }) {
  if (!file) throw new Error('No file selected');
  const path = buildPath(storeName, vendorName, date, file);
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || 'image/jpeg',
  });
  if (error) throw error;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { path, url: data?.publicUrl };
}

export function getInvoiceUrl(supabase, path) {
  if (!path) return null;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data?.publicUrl || null;
}

export async function deleteInvoice(supabase, path) {
  if (!path) return;
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw error;
}

// Upload a daily-sales receipt (shift report or safe drop) to the
// 'receipts' bucket. Path: {store-slug}/{date}/{kind}-{rand}.jpg
export async function uploadReceipt(supabase, file, { storeName, date, kind }) {
  if (!file) throw new Error('No file selected');
  const ext = (file?.name?.split('.').pop() || 'jpg').toLowerCase();
  const safeExt = /^(jpe?g|png|webp)$/i.test(ext) ? ext : 'jpg';
  const rand = Math.random().toString(36).slice(2, 10);
  const slug = (s) => String(s || 'store')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'store';
  const path = `${slug(storeName)}/${date}/${kind}-${rand}.${safeExt}`;

  const { error } = await supabase.storage.from('receipts').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || 'image/jpeg',
  });
  if (error) throw error;

  const { data } = supabase.storage.from('receipts').getPublicUrl(path);
  return { path, url: data?.publicUrl };
}

// Read a File and return its base64 payload without the data: prefix.
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result || '');
      const idx = s.indexOf('base64,');
      resolve(idx >= 0 ? s.slice(idx + 7) : s);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Resize/compress an image client-side before upload — saves bandwidth on
// mobile photos. Returns a new File with the same name + .jpg extension.
export async function compressImage(file, { maxDim = 1600, quality = 0.85 } = {}) {
  if (!file || !file.type?.startsWith('image/')) return file;
  // Skip compression on very small images.
  if (file.size < 200_000) return file;

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(
          (blob) => {
            if (!blob) return reject(new Error('compression failed'));
            const newName = file.name.replace(/\.[^.]+$/, '') + '.jpg';
            resolve(new File([blob], newName, { type: 'image/jpeg' }));
          },
          'image/jpeg',
          quality
        );
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
