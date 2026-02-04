/**
 * Supabase Edge Function: Generate Printing Passwords
 * 
 * This function runs daily (via Supabase Cron or pg_cron) to:
 * 1. Check for papers where printing_due_date + printing_due_time <= NOW()
 * 2. Generate passwords for those papers
 * 3. Send notifications to Super Admins with passwords
 * 
 * To set up cron job:
 * 1. Go to Supabase Dashboard → Database → Cron Jobs
 * 2. Create new cron job:
 *    - Schedule: 0 0 * * * (daily at midnight)
 *    - SQL: SELECT net.http_post(...) to call this function
 * 
 * Or use pg_cron extension:
 * SELECT cron.schedule(
 *   'generate-printing-passwords',
 *   '0 0 * * *',
 *   $$SELECT net.http_post(...)$$
 * );
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase credentials');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get papers that need password generation
    const { data: papersNeedingPassword, error: checkError } = await supabase.rpc(
      'check_and_generate_passwords'
    );

    if (checkError) {
      console.error('Error checking papers:', checkError);
      throw checkError;
    }

    if (!papersNeedingPassword || papersNeedingPassword.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No papers need password generation at this time',
          count: 0 
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200 
        }
      );
    }

    // Generate passwords for each paper
    const results = [];
    
    for (const paperInfo of papersNeedingPassword) {
      try {
        // Generate secure password (16 characters)
        const password = generateSecurePassword(16);
        
        // Hash password (simple SHA-256 with salt - for production use bcrypt)
        const salt = generateSecurePassword(8);
        const encoder = new TextEncoder();
        const saltedPassword = salt + password;
        const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(saltedPassword));
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        const passwordHash = `${salt}:${hashHex}`;

        // Update paper with password hash
        const { error: updateError } = await supabase
          .from('exam_papers')
          .update({
            unlock_password_hash: passwordHash,
            password_generated_at: new Date().toISOString(),
          })
          .eq('id', paperInfo.exam_paper_id);

        if (updateError) {
          console.error(`Error updating paper ${paperInfo.exam_paper_id}:`, updateError);
          results.push({
            paperId: paperInfo.exam_paper_id,
            success: false,
            error: updateError.message,
          });
          continue;
        }

        // Log password generation
        await supabase.from('paper_unlock_logs').insert({
          exam_paper_id: paperInfo.exam_paper_id,
          password_hash: passwordHash,
          generated_by: 'system',
        });

        // Get Super Admin users
        const { data: superAdmins } = await supabase
          .from('user_profiles')
          .select('id')
          .eq('is_super_admin', true);

        if (superAdmins && superAdmins.length > 0) {
          // Format printing date/time
          const printingDate = paperInfo.printing_due_timestamp
            ? new Date(paperInfo.printing_due_timestamp).toLocaleDateString()
            : 'N/A';

          // Create notifications for all Super Admins
          const notifications = superAdmins.map((admin) => ({
            user_id: admin.id,
            title: 'Paper Unlock Password Generated',
            message: `Password generated for ${paperInfo.course_code} - ${paperInfo.course_name}. Printing due: ${printingDate}. Password: ${password}`,
            type: 'info' as const,
            related_exam_paper_id: paperInfo.exam_paper_id,
          }));

          await supabase.from('notifications').insert(notifications);
        }

        results.push({
          paperId: paperInfo.exam_paper_id,
          success: true,
          courseCode: paperInfo.course_code,
        });
      } catch (error: any) {
        console.error(`Error processing paper ${paperInfo.exam_paper_id}:`, error);
        results.push({
          paperId: paperInfo.exam_paper_id,
          success: false,
          error: error.message,
        });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Processed ${papersNeedingPassword.length} papers`,
        results,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error: any) {
    console.error('Function error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message 
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});

// Generate secure password
function generateSecurePassword(length: number = 16): string {
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const numbers = '0123456789';
  const special = '!@#$%^&*()_+-=[]{}|;:,.<>?';
  
  const allChars = lowercase + uppercase + numbers + special;
  
  let password = '';
  password += lowercase[Math.floor(Math.random() * lowercase.length)];
  password += uppercase[Math.floor(Math.random() * uppercase.length)];
  password += numbers[Math.floor(Math.random() * numbers.length)];
  password += special[Math.floor(Math.random() * special.length)];
  
  for (let i = password.length; i < length; i++) {
    password += allChars[Math.floor(Math.random() * allChars.length)];
  }
  
  return password.split('').sort(() => Math.random() - 0.5).join('');
}
