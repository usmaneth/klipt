import { motion } from "framer-motion";
import { ArrowLeft, LayoutTemplate, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type MotionTemplate,
  MOTION_TEMPLATES,
  type TemplateCategory,
  TEMPLATE_CATEGORIES,
} from "@/lib/motionTemplates";

// ── Types ───────────────────────────────────────────────────────────────────

interface MotionTemplatePanelProps {
  currentTimeMs: number;
  onAddTemplate: (templateId: string, values: Record<string, string>, durationMs: number) => void;
}

// ── Thumbnail component ─────────────────────────────────────────────────────

function TemplateThumbnail({ template }: { template: MotionTemplate }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    // Dark background
    ctx.fillStyle = "#1a1a1e";
    ctx.fillRect(0, 0, w, h);

    // Build default values
    const defaults: Record<string, string> = {};
    for (const field of template.fields) {
      defaults[field.key] = field.defaultValue;
    }

    // Render at progress=0.5 (mid-animation)
    template.render(ctx, w, h, 0.5, defaults);
  }, [template]);

  return (
    <canvas
      ref={canvasRef}
      width={240}
      height={135}
      className="w-full h-auto rounded-lg"
    />
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

export function MotionTemplatePanel({
  currentTimeMs,
  onAddTemplate,
}: MotionTemplatePanelProps) {
  const [activeCategory, setActiveCategory] = useState<TemplateCategory | "all">("all");
  const [selectedTemplate, setSelectedTemplate] = useState<MotionTemplate | null>(null);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});

  const filteredTemplates = activeCategory === "all"
    ? MOTION_TEMPLATES
    : MOTION_TEMPLATES.filter((t) => t.category === activeCategory);

  const handleSelectTemplate = useCallback((template: MotionTemplate) => {
    setSelectedTemplate(template);
    const defaults: Record<string, string> = {};
    for (const field of template.fields) {
      defaults[field.key] = field.defaultValue;
    }
    setFieldValues(defaults);
  }, []);

  const handleFieldChange = useCallback((key: string, value: string) => {
    setFieldValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleAdd = useCallback(() => {
    if (!selectedTemplate) return;
    onAddTemplate(selectedTemplate.id, fieldValues, selectedTemplate.durationMs);
    setSelectedTemplate(null);
  }, [selectedTemplate, fieldValues, onAddTemplate]);

  const handleBack = useCallback(() => {
    setSelectedTemplate(null);
  }, []);

  // ── Customization view ──────────────────────────────────────────────────

  if (selectedTemplate) {
    return (
      <div className="flex flex-col gap-3 h-full">
        {/* Back button */}
        <button
          type="button"
          onClick={handleBack}
          className="flex items-center gap-1.5 text-[11px] text-white/40 hover:text-white/70 transition-colors cursor-pointer self-start"
        >
          <ArrowLeft className="w-3 h-3" />
          Back to templates
        </button>

        {/* Preview */}
        <TemplatePreview template={selectedTemplate} values={fieldValues} />

        {/* Template name */}
        <div className="flex items-center gap-2 pb-2 border-b border-white/[0.06]">
          <LayoutTemplate className="w-3.5 h-3.5 text-white/40" />
          <span className="text-[13px] font-medium text-white/80">
            {selectedTemplate.name}
          </span>
          <span className="text-[10px] text-white/30 ml-auto">
            {(selectedTemplate.durationMs / 1000).toFixed(1)}s
          </span>
        </div>

        {/* Fields */}
        <div className="flex flex-col gap-2.5">
          {selectedTemplate.fields.map((field) => (
            <div key={field.key} className="flex flex-col gap-1">
              <label className="text-[10px] text-white/40 uppercase tracking-wider">
                {field.label}
              </label>
              {field.type === "color" ? (
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={fieldValues[field.key] || field.defaultValue}
                    onChange={(e) => handleFieldChange(field.key, e.target.value)}
                    className="w-7 h-7 rounded-md border border-white/10 bg-transparent cursor-pointer"
                  />
                  <input
                    type="text"
                    value={fieldValues[field.key] || field.defaultValue}
                    onChange={(e) => handleFieldChange(field.key, e.target.value)}
                    className="flex-1 bg-black/40 border border-white/10 rounded-lg px-2.5 py-1.5 text-[11px] text-white/80 placeholder:text-white/30 outline-none focus:border-white/25 transition-colors"
                  />
                </div>
              ) : (
                <input
                  type="text"
                  value={fieldValues[field.key] || field.defaultValue}
                  onChange={(e) => handleFieldChange(field.key, e.target.value)}
                  className="bg-black/40 border border-white/10 rounded-lg px-2.5 py-1.5 text-[11px] text-white/80 placeholder:text-white/30 outline-none focus:border-white/25 transition-colors"
                />
              )}
            </div>
          ))}
        </div>

        {/* Add button */}
        <button
          type="button"
          onClick={handleAdd}
          className="mt-auto flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-[#E0000F] hover:bg-[#FF2020] text-white text-[12px] font-semibold transition-colors cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          Add to Timeline at {formatMs(currentTimeMs)}
        </button>
      </div>
    );
  }

  // ── Browse view ─────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Header */}
      <div className="flex items-center gap-2 pb-2 border-b border-white/[0.06]">
        <LayoutTemplate className="w-3.5 h-3.5 text-white/40" />
        <span className="text-[11px] font-medium text-white/50">
          {MOTION_TEMPLATES.length} templates
        </span>
      </div>

      {/* Category filter tabs */}
      <div className="flex gap-1 flex-wrap">
        {TEMPLATE_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => setActiveCategory(cat.id)}
            className={`px-2.5 py-1 rounded-full text-[10px] font-medium transition-colors cursor-pointer ${
              activeCategory === cat.id
                ? "bg-white/[0.12] text-white/80"
                : "bg-white/[0.04] text-white/30 hover:text-white/50 hover:bg-white/[0.06]"
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Template grid */}
      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-2 gap-2">
          {filteredTemplates.map((template, index) => (
            <motion.button
              key={template.id}
              type="button"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.15, delay: index * 0.03 }}
              onClick={() => handleSelectTemplate(template)}
              className="flex flex-col gap-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] hover:border-white/[0.12] p-2 transition-all cursor-pointer group"
            >
              <div className="overflow-hidden rounded-lg">
                <TemplateThumbnail template={template} />
              </div>
              <span className="text-[10px] font-medium text-white/60 group-hover:text-white/80 transition-colors truncate w-full text-left">
                {template.name}
              </span>
              <span className="text-[9px] text-white/25 capitalize text-left">
                {template.category.replace("-", " ")}
              </span>
            </motion.button>
          ))}
        </div>

        {filteredTemplates.length === 0 && (
          <p className="text-[11px] text-white/30 text-center py-8">
            No templates in this category.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Animated preview ────────────────────────────────────────────────────────

function TemplatePreview({
  template,
  values,
}: {
  template: MotionTemplate;
  values: Record<string, string>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const startRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    startRef.current = performance.now();

    const animate = (now: number) => {
      const elapsed = now - startRef.current;
      const progress = (elapsed % template.durationMs) / template.durationMs;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#1a1a1e";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      template.render(ctx, canvas.width, canvas.height, progress, values);

      animRef.current = requestAnimationFrame(animate);
    };

    animRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animRef.current);
    };
  }, [template, values]);

  return (
    <canvas
      ref={canvasRef}
      width={320}
      height={180}
      className="w-full h-auto rounded-xl border border-white/[0.06]"
    />
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
