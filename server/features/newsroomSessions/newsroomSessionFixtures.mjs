// Shared synthetic verified-photo seed. No storage transport or real credentials.
export function seedNewsroomPhoto(database, ownerId, suffix, at=Date.now()) {
 const assetId='ma_browser_'+suffix,variantId='mv_browser_'+suffix;
 const sourceKey=`users/${ownerId}/post/${suffix}-source.jpg`,renderKey=`users/${ownerId}/post/${suffix}-safe.jpg`,url='https://media.example.test/'+renderKey;
 for(const [key,scope] of [[sourceKey,'private'],[renderKey,'public']])database.prepare(`INSERT INTO media_objects(object_key,owner_id,storage_scope,purpose,byte_size,status,created_at,updated_at) VALUES (?,?,?,'post',4096,'issued',?,?)`).run(key,ownerId,scope,at,at);
 database.prepare(`INSERT INTO media_assets
  (id,owner_id,client_asset_id,create_hash,purpose,kind,source_key,source_url,source_storage_scope,original_name,mime_type,byte_size,width,height,orientation,metadata_status,codec_status,status,edit_recipe,recipe_version,finalize_hash,source_verified_at,render_state,render_variant_id,created_at,updated_at)
  VALUES (?,?,?,?,'post','image',?,?,'private','fixture.jpg','image/jpeg',4096,1200,1500,0,'declared','not_applicable','ready','{}',1,?,?,'ready',?,?,?)`)
 .run(assetId,ownerId,'browser-photo-'+suffix,'a'.repeat(64),sourceKey,'pit-private:'+sourceKey,'b'.repeat(64),at,variantId,at,at);
 database.prepare(`INSERT INTO media_variants
  (id,asset_id,client_variant_id,create_hash,role,object_key,public_url,mime_type,byte_size,width,height,status,finalize_hash,verified_at,verification_origin,created_at,updated_at)
  VALUES (?,?,?,?,'render',?,?,'image/jpeg',2048,1200,1500,'verified',?,?,'private_derivative_v1',?,?)`)
 .run(variantId,assetId,'browser-render-'+suffix,'c'.repeat(64),renderKey,url,'d'.repeat(64),at,at,at);
 database.prepare('INSERT INTO newsroom_browser_media(asset_id,owner_id,created_at) VALUES (?,?,?)').run(assetId,ownerId,at);
 return {assetId,url};
}
