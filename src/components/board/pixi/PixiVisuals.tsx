import { extend } from "@pixi/react";
import { Sprite, Texture } from "pixi.js";
import { createContext, memo, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { CardAppearance, MagnetAppearance } from "../../../lib/board/pixi/types";
import { createPhotoResource, TexturePool } from "../../../lib/board/pixi/texturePool";
import type { PhotoAsset } from "../../../lib/board/pixi/texturePool";
import { usePlayerPhotoUrl } from "../../../lib/playerPhoto";
import { getNameInitial } from "../../../lib/player";
import { skillScore } from "../../../lib/teamSelection";
import { magnetGenderInk, magnetSkillAngle, MAGNET_GENDER_RING_W, MAGNET_SKILL_ARC_RATIO } from "../../../lib/magnetStyle";
import {
	COCK_PENDING_COLOR, CTA_PLAY_FLASH, CTA_UNCONFIRM_COLOR, EMPTY_SLOT_R,
	GENDER_F_COLOR, GENDER_F_LIGHT, GENDER_M_COLOR, GENDER_M_LIGHT, HILITE_STROKE,
	MAGNET_R, MAGNET_SIZE, RESERVATION_BADGE_BG, RESERVATION_DASH, RESERVATION_OPACITY,
	RESERVATION_STROKE, RESTING_BADGE_BG, RESTING_OPACITY, RING_BG_COLOR, RING_FG_COLOR,
	STROKE_DEFAULT, TEAM_BOX_ABOVE, TEAM_BOX_BELOW, TEAM_CORNER_R, TEAM_CTA_H,
	TEAM_PAD, TEAM_VS_H, TEAM_W,
} from "../../../lib/board/constants";

extend({ Sprite });

const FONT = "Inter, system-ui, sans-serif";
const NAME_FONT = 11;
const INNER_R = MAGNET_R - MAGNET_SIZE * MAGNET_SKILL_ARC_RATIO;
const CARD_TOP = -TEAM_BOX_ABOVE;
const CARD_BOTTOM = TEAM_BOX_BELOW;
const CTA_Y = CARD_BOTTOM - TEAM_PAD - TEAM_CTA_H;
const UNCONFIRM_W = 28;
const UNCONFIRM_GAP = 6;

type Paint = (context: CanvasRenderingContext2D) => void;
interface Bounds { x: number; y: number; width: number; height: number }
interface Raster { texture: Texture; x: number; y: number }
interface TextureContextValue {
	textures: TexturePool<Raster>;
	photos: TexturePool<PhotoAsset>;
	resolution: number;
	fontRevision: number;
	invalidate: () => void;
}
const TextureContext = createContext<TextureContextValue | null>(null);

export function BoardTextureProvider({ children, resolution, invalidate }: {
	children: ReactNode;
	resolution: number;
	invalidate: () => void;
}) {
	// Constructors only allocate maps. GPU/canvas/image allocation happens after commit.
	const [pools] = useState(() => ({
		textures: new TexturePool<Raster>(),
		photos: new TexturePool<PhotoAsset>({ maxEntries: 128 }),
	}));
	const [fontRevision, setFontRevision] = useState(0);
	const lifetime = useRef(0);
	useEffect(() => {
		const generation = ++lifetime.current;
		let active = true;
		const fonts = document.fonts;
		const updateFonts = () => { if (active) setFontRevision((revision) => revision + 1); };
		fonts?.addEventListener("loadingdone", updateFonts);
		if (fonts?.status === "loading") void fonts.ready.then(updateFonts);
		return () => {
			active = false;
			fonts?.removeEventListener("loadingdone", updateFonts);
			// StrictMode replays setup/cleanup on the same state. Do not dispose its
			// live pool during that replay; a real unmount has no following setup.
			queueMicrotask(() => {
				// This is deliberately a live generation check, not a captured DOM ref.
				// eslint-disable-next-line react-hooks/exhaustive-deps
				if (lifetime.current !== generation) return;
				pools.textures.dispose();
				pools.photos.dispose();
			});
		};
	}, [pools]);
	const value = useMemo(() => ({
		textures: pools.textures, photos: pools.photos,
		resolution: Number.isFinite(resolution) && resolution > 0 ? resolution : 1,
		fontRevision, invalidate,
	}), [pools, resolution, fontRevision, invalidate]);
	return <TextureContext.Provider value={value}>{children}</TextureContext.Provider>;
}

function useTextures(): TextureContextValue {
	const context = useContext(TextureContext);
	if (!context) throw new Error("Pixi board visuals require BoardTextureProvider");
	return context;
}

function rasterize(bounds: Bounds, resolution: number, paint: Paint) {
	const canvas = document.createElement("canvas");
	canvas.width = Math.max(1, Math.ceil(bounds.width * resolution));
	canvas.height = Math.max(1, Math.ceil(bounds.height * resolution));
	const context = canvas.getContext("2d");
	if (!context) throw new Error("Board appearance canvas is unavailable");
	context.scale(resolution, resolution);
	context.translate(-bounds.x, -bounds.y);
	paint(context);
	// This pool owns the texture/source. Do not also register it in Pixi's global cache.
	const texture = Texture.from({ resource: canvas, resolution }, true);
	return {
		value: { texture, x: bounds.x, y: bounds.y },
		bytes: canvas.width * canvas.height * 4,
		destroy: () => {
			texture.destroy(true);
			canvas.width = 0;
			canvas.height = 0;
		},
	};
}

function useRaster(key: string, bounds: Bounds, paint: Paint): Raster | null {
	const { textures, resolution, fontRevision, invalidate } = useTextures();
	const paintRef = useRef(paint);
	useLayoutEffect(() => { paintRef.current = paint; });
	const [raster, setRaster] = useState<Raster | null>(null);
	const { x, y, width, height } = bounds;
	useLayoutEffect(() => {
		const lease = textures.acquire(JSON.stringify([key, resolution, fontRevision, x, y, width, height]),
			() => rasterize({ x, y, width, height }, resolution, paintRef.current));
		setRaster(lease.value);
		return () => lease.release();
	}, [textures, key, resolution, fontRevision, x, y, width, height]);
	// Asset/appearance state must first reach the Pixi reconciler; a promise
	// resolution or the outer React DOM commit alone cannot invalidate this tree.
	useLayoutEffect(() => {
		invalidate();
		return invalidate;
	});
	return raster;
}

function RasterSprite({ raster, alpha = 1 }: { raster: Raster | null; alpha?: number }) {
	return raster ? <pixiSprite texture={raster.texture} x={raster.x} y={raster.y} alpha={alpha} eventMode="none" /> : null;
}

function CachedSprite({ cacheKey, bounds, paint, alpha = 1 }: {
	cacheKey: string; bounds: Bounds; paint: Paint; alpha?: number;
}) {
	const raster = useRaster(cacheKey, bounds, paint);
	return <RasterSprite raster={raster} alpha={alpha} />;
}

function usePhoto(url: string): HTMLImageElement | null {
	const { photos } = useTextures();
	const [loaded, setLoaded] = useState<{ url: string; image: HTMLImageElement | null } | null>(null);
	useLayoutEffect(() => {
		if (!url) return;
		let active = true;
		const lease = photos.acquire(url, () => createPhotoResource(url));
		void lease.value.promise.then((image) => { if (active) setLoaded({ url, image }); });
		return () => { active = false; lease.release(); };
	}, [photos, url]);
	// A newly mounted drag preview must not flash initials while a cached source
	// promise is already resolved. Reading does not allocate or retain resources.
	return loaded?.url === url ? loaded.image : photos.peek(url)?.image ?? null;
}

function circle(context: CanvasRenderingContext2D, radius: number) {
	context.beginPath();
	context.arc(0, 0, radius, 0, Math.PI * 2);
	context.closePath();
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number) {
	context.beginPath();
	context.roundRect(x, y, w, h, radius);
}

function shadow(context: CanvasRenderingContext2D, color: string, blur: number, offsetY = 0) {
	// Canvas shadows are measured in buffer pixels, unlike transformed paths.
	const resolution = Math.abs(context.getTransform().a);
	context.shadowColor = color;
	context.shadowBlur = blur * resolution;
	context.shadowOffsetY = offsetY * resolution;
}

/** Konva 10's non-legacy text baseline, wrapping and centered line positioning. */
function text(context: CanvasRenderingContext2D, value: string, x: number, y: number, width: number, size: number,
	color: string, bold = true, height?: number, ellipsis = false) {
	context.font = `${bold ? "bold" : "normal"} ${size}px ${FONT}`;
	context.textBaseline = "alphabetic";
	context.textAlign = "left";
	context.fillStyle = color;
	const lines: string[] = [];
	for (const paragraph of value.split("\n")) {
		let remaining = Array.from(paragraph);
		if (remaining.length === 0) { lines.push(""); continue; }
		while (remaining.length) {
			let length = remaining.length;
			while (length > 0 && context.measureText(remaining.slice(0, length).join("")).width > width) length--;
			if (length === 0) break;
			if (ellipsis && length < remaining.length) {
				while (length > 0 && context.measureText(`${remaining.slice(0, length).join("").trimEnd()}…`).width > width) length--;
				lines.push(`${remaining.slice(0, length).join("").trimEnd()}…`);
				break;
			}
			if (length < remaining.length && ![" ", "-"].includes(remaining[length])) {
				const prefix = remaining.slice(0, length);
				const wordBreak = Math.max(prefix.lastIndexOf(" "), prefix.lastIndexOf("-"));
				if (wordBreak >= 0) length = wordBreak + 1;
			}
			lines.push(remaining.slice(0, length).join("").trimEnd());
			remaining = Array.from(remaining.slice(length).join("").trimStart());
			if (height != null && (lines.length + 1) * size > height) break;
		}
	}
	const metrics = context.measureText("M");
	const ascent = metrics.fontBoundingBoxAscent ?? size * 0.91;
	const descent = metrics.fontBoundingBoxDescent ?? size * 0.21;
	const baseline = (ascent - descent) / 2 + size / 2;
	const alignY = height == null ? 0 : (height - lines.length * size) / 2;
	lines.forEach((line, index) => {
		context.fillText(line, x + (width - context.measureText(line).width) / 2, y + alignY + baseline + index * size);
	});
}

function ringBand(context: CanvasRenderingContext2D, angle: number, fill: string) {
	if (angle <= 0) return;
	const start = -Math.PI / 2;
	const end = start + angle * Math.PI / 180;
	context.beginPath();
	context.arc(0, 0, MAGNET_R, start, end);
	context.arc(0, 0, INNER_R, end, start, true);
	context.closePath();
	context.fillStyle = fill;
	context.fill();
}

function bodyOpacity({ cockPending, ghost, resting }: MagnetAppearance) {
	return cockPending ? 0.5 : ghost ? RESERVATION_OPACITY : resting ? RESTING_OPACITY : 1;
}

function paintMagnet(context: CanvasRenderingContext2D, appearance: MagnetAppearance, photo: HTMLImageElement | null, withShadow: boolean) {
	const { player, ghost, cockPending } = appearance;
	// Konva applies group opacity to each primitive, not to a flattened bitmap.
	// Bake that same composition into the body; badges remain separate and opaque.
	context.globalAlpha = bodyOpacity(appearance);
	if (photo) {
		context.save();
		circle(context, INNER_R - 1);
		context.clip();
		// Preserve the existing square stretch followed by circular clipping.
		context.drawImage(photo, -INNER_R, -INNER_R, INNER_R * 2, INNER_R * 2);
		context.restore();
		if (ghost) {
			// Same channel weights as the existing Konva grayscale filter; only the
			// photo has been painted yet, so names/rings/badges retain their colors.
			const pixels = context.getImageData(0, 0, context.canvas.width, context.canvas.height);
			for (let i = 0; i < pixels.data.length; i += 4) {
				const gray = 0.34 * pixels.data[i] + 0.5 * pixels.data[i + 1] + 0.16 * pixels.data[i + 2];
				pixels.data[i] = gray; pixels.data[i + 1] = gray; pixels.data[i + 2] = gray;
			}
			context.putImageData(pixels, 0, 0);
		}
		context.save();
		circle(context, INNER_R - 1);
		context.clip();
		const gradientHeight = MAGNET_SIZE * 0.7;
		const gradient = context.createLinearGradient(0, MAGNET_R, 0, MAGNET_R - gradientHeight);
		gradient.addColorStop(0, "rgba(0,0,0,0.9)");
		gradient.addColorStop(0.6, "rgba(0,0,0,0.4)");
		gradient.addColorStop(1, "rgba(0,0,0,0)");
		context.fillStyle = gradient;
		context.fillRect(-MAGNET_R, MAGNET_R - gradientHeight, MAGNET_SIZE, gradientHeight);
		context.restore();
	} else {
		circle(context, INNER_R);
		context.fillStyle = ghost ? "#D1D5DB" : player.gender === "F" ? GENDER_F_LIGHT : GENDER_M_LIGHT;
		context.fill();
		text(context, getNameInitial(player.name), -INNER_R, -INNER_R, INNER_R * 2, INNER_R * 0.8,
			ghost ? "#6B7280" : magnetGenderInk(player.gender), true, INNER_R * 2);
	}
	circle(context, INNER_R - MAGNET_GENDER_RING_W / 2);
	context.strokeStyle = ghost ? "#9CA3AF" : player.gender === "F" ? GENDER_F_COLOR : GENDER_M_COLOR;
	context.lineWidth = MAGNET_GENDER_RING_W;
	context.stroke();
	ringBand(context, 360, RING_BG_COLOR);
	ringBand(context, magnetSkillAngle(skillScore(player)), ghost ? "#9CA3AF" : RING_FG_COLOR);
	context.save();
	if (withShadow) shadow(context, "rgba(0,0,0,0.6)", 3, 1);
	text(context, player.name, -MAGNET_R, MAGNET_R - NAME_FONT - 10, MAGNET_SIZE, NAME_FONT, "#FFFFFF");
	context.restore();
	circle(context, MAGNET_R);
	context.strokeStyle = ghost ? RESERVATION_STROKE : "rgba(0,0,0,0.15)";
	context.lineWidth = ghost ? 2 : 1;
	context.setLineDash(ghost ? RESERVATION_DASH : []);
	context.stroke();
	context.setLineDash([]);
	if (cockPending) {
		circle(context, INNER_R);
		context.fillStyle = "rgba(70,72,82,0.55)";
		context.fill();
		circle(context, MAGNET_R);
		context.strokeStyle = COCK_PENDING_COLOR;
		context.lineWidth = 2.5;
		context.setLineDash([4, 3]);
		context.stroke();
		context.setLineDash([]);
	}
}

function Badge({ label, fill }: { label: string; fill: string }) {
	return <CachedSprite cacheKey={`badge:${label}:${fill}`}
		bounds={{ x: MAGNET_R - 24, y: -MAGNET_R - 1, width: 32, height: 18 }}
		paint={(context) => {
			const x = MAGNET_R - 24; const y = -MAGNET_R - 1;
			roundedRect(context, x, y, 32, 18, 9);
			context.fillStyle = fill;
			context.fill();
			text(context, label, x, y, 32, 10, "#FFFFFF", true, 18);
		}} />;
}

export const MagnetVisual = memo(function MagnetVisual({ appearance, dragging, hovered }: {
	appearance: MagnetAppearance; dragging: boolean; hovered: boolean;
}) {
	const url = usePlayerPhotoUrl(appearance.player.memberId);
	const photo = usePhoto(url);
	const { player, ghost, cockPending, resting } = appearance;
	const key = JSON.stringify(["magnet", player.name, player.gender, skillScore(player), ghost, cockPending, resting, url, !!photo]);
	const nameBottom = MAGNET_R - NAME_FONT - 10 + Math.ceil(Array.from(player.name).length * NAME_FONT / MAGNET_SIZE) * NAME_FONT + 5;
	const bounds = { x: -40, y: -40, width: 80, height: Math.max(40, nameBottom) + 40 };
	// Prewarm both small variants during asset preparation, not on pointerdown.
	const normal = useRaster(`${key}:shadow`, bounds, (context) => paintMagnet(context, appearance, photo, true));
	const moving = useRaster(`${key}:flat`, bounds, (context) => paintMagnet(context, appearance, photo, false));
	return <>
		<RasterSprite raster={dragging ? moving : normal} />
		{hovered && <CachedSprite cacheKey={`magnet-hover:${dragging}`} alpha={bodyOpacity(appearance)}
			bounds={{ x: -52, y: -52, width: 104, height: 104 }} paint={(context) => {
				circle(context, MAGNET_R + 3);
				context.strokeStyle = HILITE_STROKE;
				context.lineWidth = 3;
				if (!dragging) shadow(context, HILITE_STROKE, 10);
				context.stroke();
			}} />}
		{cockPending && <Badge label="콕?" fill={COCK_PENDING_COLOR} />}
		{ghost && <Badge label="경기중" fill={RESERVATION_BADGE_BG} />}
		{resting && <Badge label="휴식" fill={RESTING_BADGE_BG} />}
	</>;
});

function paintCard(context: CanvasRenderingContext2D, appearance: CardAppearance) {
	const halfW = TEAM_W / 2;
	roundedRect(context, -halfW, CARD_TOP, TEAM_W, CARD_BOTTOM - CARD_TOP, TEAM_CORNER_R);
	context.fillStyle = appearance.fill;
	context.fill();
	context.strokeStyle = appearance.stroke;
	context.lineWidth = 2;
	context.stroke();
	text(context, appearance.label, -halfW, CARD_TOP + TEAM_PAD, TEAM_W, 11,
		appearance.labelColor, appearance.labelBold, undefined, true);
	if (appearance.showVs) text(context, "vs", -halfW, -TEAM_VS_H / 2, TEAM_W, 10, `${appearance.labelColor}80`);
	if (appearance.showEdit) {
		context.save();
		context.translate(halfW - 22, CARD_TOP + 8);
		roundedRect(context, -4, -4, 24, 24, 6);
		context.fillStyle = "rgba(255,255,255,0.08)";
		context.fill();
		context.scale(0.62, 0.62);
		context.strokeStyle = appearance.stroke;
		context.lineWidth = 2.6;
		context.lineCap = "round";
		context.lineJoin = "round";
		context.stroke(new Path2D("M12 20h9 M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"));
		context.restore();
	}
}

function paintCardControls(context: CanvasRenderingContext2D, appearance: CardAppearance, flash: boolean) {
	const halfW = TEAM_W / 2;
	if (appearance.showUnconfirm) {
		const x = -halfW + TEAM_PAD;
		roundedRect(context, x, CTA_Y, UNCONFIRM_W, TEAM_CTA_H, 8);
		context.fillStyle = CTA_UNCONFIRM_COLOR;
		context.fill();
		context.save();
		context.strokeStyle = "#CBD5E1";
		context.lineWidth = 2;
		context.lineCap = "round";
		context.beginPath();
		context.moveTo(x + UNCONFIRM_W / 2 - 5, CTA_Y + TEAM_CTA_H / 2 - 5);
		context.lineTo(x + UNCONFIRM_W / 2 + 5, CTA_Y + TEAM_CTA_H / 2 + 5);
		context.moveTo(x + UNCONFIRM_W / 2 + 5, CTA_Y + TEAM_CTA_H / 2 - 5);
		context.lineTo(x + UNCONFIRM_W / 2 - 5, CTA_Y + TEAM_CTA_H / 2 + 5);
		context.stroke();
		context.restore();
	}
	const ctaOffset = appearance.showUnconfirm ? UNCONFIRM_W + UNCONFIRM_GAP : 0;
	const ctaX = -halfW + TEAM_PAD + ctaOffset;
	const ctaW = TEAM_W - TEAM_PAD * 2 - ctaOffset;
	roundedRect(context, ctaX, CTA_Y, ctaW, TEAM_CTA_H, 8);
	context.fillStyle = appearance.blink && flash ? CTA_PLAY_FLASH : appearance.ctaColor;
	context.fill();
	if (appearance.blink && flash) {
		context.strokeStyle = "#FDE68A";
		context.lineWidth = 2;
		context.stroke();
	}
	text(context, appearance.ctaLabel, ctaX, CTA_Y, ctaW, 13, "#FFFFFF", true, TEAM_CTA_H);
}

const CARD_BOUNDS = { x: -TEAM_W / 2 - 2, y: CARD_TOP - 2, width: TEAM_W + 4, height: CARD_BOTTOM - CARD_TOP + 4 };

export const CardVisual = memo(function CardVisual({ appearance, dragging }: {
	appearance: CardAppearance; dragging: boolean; flash: boolean;
}) {
	const key = JSON.stringify(["card", appearance.fill, appearance.stroke, appearance.label,
		appearance.labelColor, appearance.labelBold, appearance.showVs, appearance.showEdit]);
	const raster = useRaster(key, CARD_BOUNDS, (context) => paintCard(context, appearance));
	return <>
		{!dragging && <CachedSprite cacheKey="card-shadow"
			bounds={{ x: -TEAM_W / 2 - 24, y: CARD_TOP - 24, width: TEAM_W + 48, height: CARD_BOTTOM - CARD_TOP + 52 }}
			paint={(context) => {
				roundedRect(context, -TEAM_W / 2, CARD_TOP, TEAM_W, CARD_BOTTOM - CARD_TOP, TEAM_CORNER_R);
				shadow(context, "rgba(0,0,0,0.3)", 12, 4);
				context.fillStyle = "#000000";
				context.fill();
			}} />}
		<RasterSprite raster={raster} />
	</>;
});

/** Render after card members: long names and a dragged member must not cover the CTA. */
export const CardControlsVisual = memo(function CardControlsVisual({ appearance, dragging, flash }: {
	appearance: CardAppearance; dragging: boolean; flash: boolean;
}) {
	const key = JSON.stringify(["card-controls", appearance.ctaLabel, appearance.ctaColor, appearance.showUnconfirm, appearance.blink]);
	const bounds = { x: -TEAM_W / 2, y: CTA_Y - 2, width: TEAM_W, height: TEAM_CTA_H + 4 };
	const normal = useRaster(`${key}:normal`, bounds, (context) => paintCardControls(context, appearance, false));
	const highlighted = useRaster(`${key}:${appearance.blink ? "flash" : "normal"}`, bounds,
		(context) => paintCardControls(context, appearance, true));
	const ctaOffset = appearance.showUnconfirm ? UNCONFIRM_W + UNCONFIRM_GAP : 0;
	return <>
		{appearance.blink && flash && !dragging && <CachedSprite cacheKey={`cta-glow:${ctaOffset}`}
			bounds={{ x: -TEAM_W / 2 - 22, y: CTA_Y - 30, width: TEAM_W + 44, height: TEAM_CTA_H + 60 }}
			paint={(context) => {
				const x = -TEAM_W / 2 + TEAM_PAD + ctaOffset;
				const width = TEAM_W - TEAM_PAD * 2 - ctaOffset;
				roundedRect(context, x, CTA_Y, width, TEAM_CTA_H, 8);
				shadow(context, CTA_PLAY_FLASH, 14);
				context.fillStyle = CTA_PLAY_FLASH;
				context.fill();
				// Keep only the glow; the following Sprite contains the button/text.
				context.shadowColor = "transparent";
				context.globalCompositeOperation = "destination-out";
				context.fill();
			}} />}
		<RasterSprite raster={appearance.blink && flash ? highlighted : normal} />
	</>;
});

export const EmptySlotVisual = memo(function EmptySlotVisual() {
	return <CachedSprite cacheKey="empty-slot"
		bounds={{ x: -EMPTY_SLOT_R - 2, y: -EMPTY_SLOT_R - 2, width: EMPTY_SLOT_R * 2 + 4, height: EMPTY_SLOT_R * 2 + 4 }}
		paint={(context) => {
			circle(context, EMPTY_SLOT_R);
			context.fillStyle = "rgba(0,0,0,0.001)";
			context.fill();
			context.strokeStyle = STROKE_DEFAULT;
			context.lineWidth = 2;
			context.stroke();
			context.beginPath();
			context.moveTo(-8, 0); context.lineTo(8, 0);
			context.moveTo(0, -8); context.lineTo(0, 8);
			context.stroke();
		}} />;
});

export const SlotHoverVisual = memo(function SlotHoverVisual() {
	return <CachedSprite cacheKey="slot-hover"
		bounds={{ x: -40, y: -40, width: 80, height: 80 }}
		paint={(context) => {
			circle(context, MAGNET_R + 4);
			context.fillStyle = `${HILITE_STROKE}22`;
			context.fill();
			context.strokeStyle = HILITE_STROKE;
			context.lineWidth = 3.5;
			context.stroke();
		}} />;
});
