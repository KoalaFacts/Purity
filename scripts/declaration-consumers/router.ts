// Consumer of the built `@purityjs/router` declarations (SV2-014 slice 2).
import { type RouteData, loaderData, manageTitle, routeData } from '@purityjs/router';

import { type Equal, expectType } from './expect';

const data = routeData({ posts: [1, 2] }, { status: 201, headers: { 'x-a': '1' } });
expectType<Equal<typeof data, RouteData<{ posts: number[] }>>>();
const value: { posts: number[] } = data.value;
const headers: Headers = data.headers;
// @ts-expect-error route data is read-only
data.value = { posts: [] };
// @ts-expect-error status is a number
routeData(1, { status: '201' });

const loaded = loaderData<{ id: string }>();
expectType<Equal<typeof loaded, { id: string } | undefined>>();
// @ts-expect-error loader data may be missing outside a route
const eager: { id: string } = loaderData<{ id: string }>();

const stopTitle: () => void = manageTitle(() => 'Home');
// @ts-expect-error the title source returns a string
manageTitle(() => 1);

void [value, headers, eager, stopTitle];
