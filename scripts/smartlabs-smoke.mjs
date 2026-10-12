// Explicit operator entry only. Never invoke from CI, health, startup or cron.
// Context is trusted installed BACKEND code, not a browser payload or actor ID.
import {readSmartLabsConfig} from '../packages/agent-runtime/providers/smartlabs.mjs';
import {isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
const args=process.argv.slice(2);
function stop(code){throw Object.assign(new Error(code),{code});}
try {
 if(args.some(a=>!a.startsWith('--confirm=')&&!a.startsWith('--trusted-context='))||args.filter(a=>a.startsWith('--confirm=')).length!==1||!args.includes('--confirm=ISSUE242_ONE_ATTEMPT'))stop('smoke_confirmation_required');
 const contexts=args.filter(a=>a.startsWith('--trusted-context='));if(contexts.length!==1)stop('trusted_backend_context_required');
 const contextPath=contexts[0].slice('--trusted-context='.length);
 if(!isAbsolute(contextPath)||contextPath.startsWith('\\\\')||contextPath.includes('\0'))stop('trusted_backend_context_required');
 for(const name of ['SMARTLABS_GEMMA_ENABLED','SMARTLABS_TTS_ENABLED','SMARTLABS_ASR_ENABLED'])if(process.env[name]!=='true')stop('operator_configuration_required');
 const config=readSmartLabsConfig(process.env);
 if(!config.gemmaKey||!config.apiKey)stop('operator_configuration_required');
 const module=await import(pathToFileURL(contextPath).href);
 if(typeof module.createSmokeContext!=='function')stop('trusted_backend_context_required');
 // Operator attestation is not cryptographic proof of review/CI. The installed
 // context must use smartLabsRuntime with a real authenticated owner request.
 const context=await module.createSmokeContext();
 if(context?.sourceGatesPassed!==true||context.providerAuthorization!=='ISSUE242_G1_T1_A1'||typeof context.runtime?.smoke!=='function')stop('source_review_and_operator_authorization_required');
 const receipt=await context.runtime.smoke({jobId:context.jobId,confirmation:'ISSUE242_ONE_ATTEMPT'});
 if(receipt?.status!=='REVIEW_REQUIRED'||receipt.T1?.status!=='draft'||receipt.A1?.status!=='NOT_RUN_REQUIRES_APPROVED_SOURCE'||receipt.A1.sourceVersionId!==receipt.T1.assetVersionId||receipt.issue!==242||receipt.quality_certified!==false||receipt.production_activated!==false)stop('smoke_receipt_invalid');
 const serialized=JSON.stringify(receipt);
 if([config.gemmaKey,config.apiKey].some(k=>k&&(serialized.includes(k)||serialized.includes(JSON.stringify(k).slice(1,-1)))))stop('smoke_receipt_invalid');
 console.log(serialized);
} catch(error) {
 const allowed=['smoke_confirmation_required','trusted_backend_context_required','operator_configuration_required','source_review_and_operator_authorization_required','smoke_receipt_invalid','smoke_already_reserved','smoke_busy','smoke_configuration_required','asset_recovery_required','attempt_already_reserved','authentication_failed','account_forbidden','provider_busy','provider_unavailable','provider_timeout','insufficient_credits','deadline_exceeded','transport_indeterminate','exact_token_counter_required','thinking_contract_required'];
 const code=allowed.includes(error?.code)?error.code:'smoke_failed_recovery_required';
 console.error(JSON.stringify({status:'BLOCKED',code}));process.exitCode=2;
}
