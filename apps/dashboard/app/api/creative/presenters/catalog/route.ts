import type {NextRequest} from "next/server";
import {apiFailure} from "@/lib/server/responses";
import {presenterCatalog} from "@/lib/server/creative/presenters";
export const runtime="nodejs";
export async function GET(request:NextRequest){try{return await presenterCatalog(request);}catch(error){return apiFailure(error);}}
