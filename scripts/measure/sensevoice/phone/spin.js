// Fixed amount of float work, then report how long it took.
onmessage = ({ data: n }) => {
	const t = performance.now();
	let x = 0;
	for (let i = 0; i < n; i++) x += Math.sqrt(i) * 1e-9;
	postMessage({ ms: performance.now() - t, x });
};
