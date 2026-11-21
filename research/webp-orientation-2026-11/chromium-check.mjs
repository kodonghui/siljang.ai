// 합성 출력의 첫 프레임을 Chromium의 실제 이미지 디코더·캔버스로 확인한다.
const { chromium } = await import(
	process.env.PLAYWRIGHT_MODULE ?? "playwright"
);
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
const folder = process.argv[2],
	expected = JSON.parse(readFileSync(process.argv[3], "utf8")),
	report = process.argv[4];
const server = createServer((req, res) => {
	const name = req.url.slice(1);
	if (!/^[a-z0-9-]+\.webp$/.test(name)) {
		res.writeHead(404).end();
		return;
	}
	try {
		res
			.writeHead(200, {
				"Content-Type": "image/webp",
				"Access-Control-Allow-Origin": "*",
			})
			.end(readFileSync(folder + "/" + name));
	} catch {
		res.writeHead(404).end();
	}
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const results = [];
try {
	for (const e of expected) {
		const result = await page.evaluate(
			async ({ url, e }) => {
				const image = new Image();
				image.crossOrigin = "anonymous";
				image.src = url;
				await image.decode();
				const c = document.createElement("canvas");
				c.width = image.naturalWidth;
				c.height = image.naturalHeight;
				const ctx = c.getContext("2d");
				ctx.drawImage(image, 0, 0);
				return {
					width: c.width,
					height: c.height,
					corners: e.points.map((p) =>
						Array.from(ctx.getImageData(p.x, p.y, 1, 1).data),
					),
				};
			},
			{
				url:
					"http://127.0.0.1:" + server.address().port + "/" + e.name + ".webp",
				e,
			},
		);
		const dimensions = result.width === e.width && result.height === e.height;
		const colors = result.corners.every(
			(v, i) =>
				v[3] === e.points[i].rgba[3] &&
				(!v[3] ||
					v
						.slice(0, 3)
						.every((n, k) => Math.abs(n - e.points[i].rgba[k]) <= 16)),
		);
		results.push({
			name: e.name,
			passed: dimensions && colors,
			dimensions,
			corners: colors,
			width: result.width,
			height: result.height,
		});
	}
	writeFileSync(
		report,
		JSON.stringify(
			{
				browser: browser.version(),
				measurement:
					"HTMLImageElement.decode and canvas first frame; all animation frames checked separately by Pillow",
				results,
			},
			null,
			2,
		) + "\n",
	);
	console.log(
		JSON.stringify({
			browser: browser.version(),
			cases: results.length,
			passed: results.filter((r) => r.passed).length,
		}),
	);
	if (results.some((r) => !r.passed)) process.exitCode = 1;
} finally {
	await browser.close();
	await new Promise((r) => server.close(r));
}
