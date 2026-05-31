// Typed WireJoke fixtures for icanhazdadjoke.test.ts — recorded shapes from the
// JSON variant of https://icanhazdadjoke.com/. Drive fetchJoke through a stub
// fetch without any live HTTP.

import type { WireJoke } from './types';

// A medium-length joke — the common case.
export const classicJoke: WireJoke = {
	id: 'R7UfaahVfFd',
	joke: 'My dog used to chase people on a bike a lot. It got so bad I had to take his bike away.',
	status: 200,
};

// A short one-liner — exercises the larger font bucket downstream.
export const shortJoke: WireJoke = {
	id: '0LuXvkq4Mub',
	joke: 'Why did the scarecrow win an award? He was outstanding in his field.',
	status: 200,
};

// Leading/trailing whitespace the mapper must trim.
export const paddedJoke: WireJoke = {
	id: 'M7wPC5wzJhb',
	joke: '  I only know 25 letters of the alphabet. I dont know y.  ',
	status: 200,
};
