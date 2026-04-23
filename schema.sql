-- SCHEMA FOR RECEPCIONPRO
-- Create this in your Supabase SQL Editor

-- 1. Table for Manifests (Planillas)
CREATE TABLE IF NOT EXISTS public.planillas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre TEXT NOT NULL,
    proveedor TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    total_items INTEGER DEFAULT 0
);

-- 2. Table for Expected Items in Manifest
CREATE TABLE IF NOT EXISTS public.planilla_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    planilla_id UUID REFERENCES public.planillas(id) ON DELETE CASCADE,
    codigo_barras TEXT NOT NULL,
    alias_barras TEXT,           -- Comma-separated alternate barcodes (e.g. EAN, UPC)
    descripcion TEXT,
    cantidad_esperada INTEGER NOT NULL DEFAULT 0,
    unidad TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Run this if the table already exists:
-- ALTER TABLE public.planilla_items ADD COLUMN IF NOT EXISTS alias_barras TEXT;

-- 3. Table for Reception Sessions
CREATE TABLE IF NOT EXISTS public.sesiones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    planilla_id UUID REFERENCES public.planillas(id),
    nombre TEXT NOT NULL,
    proveedor TEXT,
    notas TEXT,
    estado TEXT DEFAULT 'abierta', -- 'abierta', 'finalizada'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    finalizada_at TIMESTAMP WITH TIME ZONE
);

-- 4. Table for Individual Scans
CREATE TABLE IF NOT EXISTS public.escaneos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sesion_id UUID REFERENCES public.sesiones(id) ON DELETE CASCADE,
    codigo_barras TEXT NOT NULL,
    cantidad INTEGER NOT NULL DEFAULT 1,
    metodo TEXT DEFAULT 'camara', -- 'camara', 'manual', 'lector'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS and simple policies (for demo purposes, adjust as needed)
ALTER TABLE public.planillas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planilla_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sesiones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.escaneos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for anonymous" ON public.planillas FOR ALL USING (true);
CREATE POLICY "Allow all for anonymous" ON public.planilla_items FOR ALL USING (true);
CREATE POLICY "Allow all for anonymous" ON public.sesiones FOR ALL USING (true);
CREATE POLICY "Allow all for anonymous" ON public.escaneos FOR ALL USING (true);
