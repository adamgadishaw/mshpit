import { createCityGuideRepository } from "./cityGuideRepository.js";
import { CityValidationError } from "./cityValidation.js";

export function cityGuideRoutes({ database,ApiError,requireAdmin,rateLimit,now=Date.now }) {
  if (!database?.prepare || typeof ApiError!=="function" || typeof requireAdmin!=="function" || typeof rateLimit!=="function") {
    throw new TypeError("City guide routes require authorization, errors, and rate limits");
  }
  const repository=createCityGuideRepository(database);
  const noStore=(ctx)=>ctx.setHeader?.("Cache-Control","private, no-store");
  const params=(ctx)=>{
    const countryCode=String(ctx.params?.countryCode || "").toUpperCase(),citySlug=String(ctx.params?.citySlug || "").toLowerCase();
    if (!/^[A-Z]{2}$/u.test(countryCode) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(citySlug) || citySlug.length>80) {
      throw new ApiError(400,"Choose a valid city.","VALIDATION_FAILED");
    }
    return {countryCode,citySlug};
  };
  const revision=(ctx)=>{
    const value=ctx.body?.revision;
    if (!Number.isSafeInteger(value) || value<0) throw new ApiError(400,"Reload this page before saving changes.","VALIDATION_FAILED");
    return value;
  };
  const result=(saved)=>{
    if (saved.notFound) throw new ApiError(404,"That city is not listed.","NOT_FOUND");
    if (saved.conflict) throw new ApiError(409,"This content changed after you opened it. Reload before saving.","CONFLICT");
  };
  const validated=(action)=>{try{return action();}catch(error){if(error instanceof CityValidationError)throw new ApiError(400,error.message,"VALIDATION_FAILED");throw error;}};
  const directory=(ctx)=>{
    const q=ctx.query?.q || "",country=ctx.query?.country || "",cursor=ctx.query?.cursor ?? null;
    if (typeof q!=="string" || q.length>160 || (country && !/^[A-Za-z]{2}$/u.test(country))
      || (cursor!=null && !/^\d{1,7}$/u.test(String(cursor)))) throw new ApiError(400,"Choose valid city search filters.","VALIDATION_FAILED");
    return {...repository.listCities({q,country,limit:ctx.query?.limit,cursor,at:now()}),copy:repository.readCopy().copy};
  };
  return Object.freeze({
    "GET /api/cities":(ctx)=>{rateLimit(ctx,"city-directory",120,60_000);noStore(ctx);return directory(ctx);},
    "GET /api/city-copy":(ctx)=>{ctx.setHeader?.("Cache-Control","public, max-age=60");return repository.readCopy();},
    "GET /api/cities/:countryCode/:citySlug":(ctx)=>{
      rateLimit(ctx,"city-guide",120,60_000);noStore(ctx);
      const guide=repository.getGuide({...params(ctx),viewerId:ctx.user?.id || null,at:now()});
      if(!guide)throw new ApiError(404,"That city is not listed.","NOT_FOUND");return guide;
    },
    "GET /api/admin/cities":(ctx)=>{requireAdmin(ctx);noStore(ctx);return directory(ctx);},
    "GET /api/admin/cities/:countryCode/:citySlug":(ctx)=>{
      requireAdmin(ctx);noStore(ctx);const guide=repository.getGuide({...params(ctx),viewerId:ctx.user?.id || null,at:now()});
      if(!guide)throw new ApiError(404,"That city is not listed.","NOT_FOUND");return guide;
    },
    "PUT /api/admin/cities/:countryCode/:citySlug":(ctx)=>{
      const actor=requireAdmin(ctx);rateLimit(ctx,"city-editorial-save",60,600_000);noStore(ctx);
      const identity=params(ctx),expected=revision(ctx);
      const saved=validated(()=>repository.saveEditorial({...identity,revision:expected,editorial:ctx.body?.editorial,
        actorId:actor.id,requestId:ctx.requestId,at:now()}));result(saved);
      return repository.getGuide({...identity,viewerId:actor.id,at:now()});
    },
    "GET /api/admin/city-copy":(ctx)=>{requireAdmin(ctx);noStore(ctx);return repository.readCopy();},
    "PUT /api/admin/city-copy":(ctx)=>{
      const actor=requireAdmin(ctx);rateLimit(ctx,"city-copy-save",30,600_000);noStore(ctx);
      const saved=validated(()=>repository.saveCopy({revision:revision(ctx),copy:ctx.body?.copy,
        actorId:actor.id,requestId:ctx.requestId,at:now()}));result(saved);return repository.readCopy();
    },
  });
}
