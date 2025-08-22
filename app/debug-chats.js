const fetch = require('node-fetch');

// Green API Configuration
const idInstance = '7103899702';
const apiTokenInstance = 'cf5010eda4fd493f99b6b6d367bfd911b56d9d43041b44f3b3';
const baseUrl = 'https://api.greenapi.com';

async function debugChats() {
    console.log('🔍 Debugging Green API chats structure...\n');
    
    try {
        // 1. Check instance state
        console.log('1. Checking instance state...');
        const stateResponse = await fetch(`${baseUrl}/waInstance${idInstance}/getStateInstance/${apiTokenInstance}`);
        const state = await stateResponse.json();
        console.log(`State: ${JSON.stringify(state, null, 2)}`);
        
        if (state.stateInstance !== 'authorized') {
            console.log('❌ Instance not authorized, cannot fetch chats');
            return;
        }
        
        console.log('✅ Instance is authorized, fetching chats...\n');
        
        // 2. Fetch chats
        console.log('2. Fetching chats...');
        const chatsResponse = await fetch(`${baseUrl}/waInstance${idInstance}/getChats/${apiTokenInstance}`);
        console.log(`Status: ${chatsResponse.status}`);
        
        if (chatsResponse.ok) {
            const chats = await chatsResponse.json();
            console.log(`📊 Total chats received: ${chats.length}`);
            
            // 3. Analyze chat structure
            console.log('\n3. Analyzing chat structure...');
            
            // Count different types
            const groups = chats.filter(chat => chat.id && chat.id.includes('@g.us'));
            const individuals = chats.filter(chat => chat.id && !chat.id.includes('@g.us'));
            const withNames = chats.filter(chat => chat.name);
            const withoutNames = chats.filter(chat => !chat.name);
            
            console.log(`📈 Statistics:`);
            console.log(`- Groups (@g.us): ${groups.length}`);
            console.log(`- Individuals: ${individuals.length}`);
            console.log(`- With names: ${withNames.length}`);
            console.log(`- Without names: ${withoutNames.length}`);
            
            // Show first few groups
            console.log('\n📋 First 10 groups:');
            groups.slice(0, 10).forEach((group, index) => {
                console.log(`${index + 1}. ID: ${group.id}`);
                console.log(`   Name: ${group.name || 'NO NAME'}`);
                console.log(`   Subject: ${group.subject || 'NO SUBJECT'}`);
                console.log(`   Type: ${group.type || 'NO TYPE'}`);
                console.log('');
            });
            
            // Show groups without names
            const groupsWithoutNames = groups.filter(group => !group.name);
            if (groupsWithoutNames.length > 0) {
                console.log(`\n⚠️ Groups without names (${groupsWithoutNames.length}):`);
                groupsWithoutNames.slice(0, 5).forEach((group, index) => {
                    console.log(`${index + 1}. ID: ${group.id}`);
                    console.log(`   Subject: ${group.subject || 'NO SUBJECT'}`);
                    console.log(`   Type: ${group.type || 'NO TYPE'}`);
                    console.log('');
                });
            }
            
            // Show sample chat structure
            if (chats.length > 0) {
                console.log('\n🔍 Sample chat structure:');
                console.log(JSON.stringify(chats[0], null, 2));
            }
            
        } else {
            const errorText = await chatsResponse.text();
            console.log(`❌ Error: ${errorText}`);
        }
        
    } catch (error) {
        console.error('❌ Debug error:', error.message);
    }
}

debugChats();

