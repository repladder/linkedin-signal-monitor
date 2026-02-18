const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function setupDatabase() {
  console.log('🔧 Setting up database...\n');

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Error: SUPABASE_URL and SUPABASE_KEY must be set in .env file');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // Read schema file
    const schemaPath = path.join(__dirname, '..', 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    console.log('📄 Schema file loaded');
    console.log('\n⚠️  IMPORTANT: You need to run the schema.sql file manually in Supabase SQL Editor\n');
    console.log('Steps:');
    console.log('1. Go to your Supabase project dashboard');
    console.log('2. Click on "SQL Editor" in the left sidebar');
    console.log('3. Click "New Query"');
    console.log('4. Copy and paste the contents of schema.sql');
    console.log('5. Click "Run"\n');

    console.log('Schema file location:', schemaPath);
    console.log('\n✅ Once you\'ve run the schema in Supabase, your database will be ready!');

    // Test connection
    console.log('\n🔍 Testing database connection...');
    const { error } = await supabase.from('users').select('count').limit(1);
    
    if (error) {
      if (error.message.includes('relation "users" does not exist')) {
        console.log('⚠️  Database tables not yet created. Please run schema.sql in Supabase SQL Editor.');
      } else {
        console.error('❌ Database connection failed:', error.message);
      }
    } else {
      console.log('✅ Database connection successful!');
      console.log('✅ Tables are ready!');
    }

  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    process.exit(1);
  }
}

setupDatabase();
