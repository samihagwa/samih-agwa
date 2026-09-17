import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import ts from "typescript";
const src=await readFile(new URL("../lib/carousel-images.ts",import.meta.url),"utf8");
const code=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const c=await import("data:text/javascript;base64,"+Buffer.from(code).toString("base64"));
test("carousel requires ordered distinct safe image links",()=>{
 const links=["https://example.com/2.png","https://example.com/1.png"];
 assert.equal(c.carouselImagesError(links),null);
 assert.deepEqual(c.carouselImages(links),links);
 assert.ok(c.carouselImagesError([links[0]]));
 assert.ok(c.carouselImagesError([links[0],links[0]]));
 assert.ok(c.carouselImagesError(["javascript:alert(1)",links[0]]));
 assert.ok(c.carouselImagesError(["https://user:pass@example.com/1.png",links[0]]));
});
test("carousel uses design and publishing only; delivery preserves CAS and order",async()=>{
 const content=await readFile(new URL("../lib/content.ts",import.meta.url),"utf8");
 const sql=await readFile(new URL("../supabase/migrations/20260917134403_content_request_formats_and_carousel_delivery.sql",import.meta.url),"utf8");
 const form=await readFile(new URL("../components/content/VisualContentIntake.tsx",import.meta.url),"utf8");
 assert.match(content,/format === "carousel".*\["design","publishing"\]/);
 assert.match(sql,/current_version is distinct from expected_delivery_version/);
 assert.match(sql,/new.result_images:=images/);
 assert.match(sql,/if not is_carousel then/);
 assert.match(form,/ahmed shaban/);
 assert.match(form,/name="owner"/);
});
